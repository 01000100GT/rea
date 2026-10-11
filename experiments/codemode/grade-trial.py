"""Check requested JSON facts and real Evidence references against a replay oracle."""

import argparse
import hashlib
import json
from pathlib import Path


def required_field(row, key):
    return row[key] if key in row else {'missing_field': key}


def same_fact(actual, expected):
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(
            same_fact(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(
            same_fact(a, b) for a, b in zip(actual, expected))
    return actual == expected


def evidence_ids(value):
    if isinstance(value, str):
        return {value} if value.startswith('ev_') and len(value) == 67 else set()
    if isinstance(value, dict):
        return set().union(*(evidence_ids(v) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(evidence_ids(v) for v in value))
    return set()


def read_answer(path):
    source = path.read_text().strip()
    lines = source.splitlines()
    # Accept a single complete JSON fence, never repair prose or partial JSON.
    if len(lines) >= 3 and lines[0] == '```json' and lines[-1] == '```':
        source = '\n'.join(lines[1:-1])
        answer_format = 'markdown_json'
    else:
        answer_format = 'json'
    answer = json.loads(source)
    if not isinstance(answer, dict):
        raise ValueError('Answer is not a JSON object')
    return answer, answer_format


def requested_facts(value, task):
    if task == 'native':
        facts = {field: value.get(field) for field in [
            'artifact_sha256', 'entry_address', 'containing_procedure',
            'procedure', 'pseudocode_prefix', 'caller_count', 'callee_count']}
        containing = facts['containing_procedure']
        if isinstance(containing, dict) and containing.get('found', True) is True and \
                containing.get('query_address', facts['entry_address']) == facts['entry_address']:
            identity = containing.get('procedure', containing)
            if isinstance(identity, dict):
                facts['containing_procedure'] = {key: identity.get(key) for key in ['address', 'name']}
        return facts
    if task == 'electron-inventory':
        facts = {field: value.get(field) for field in [
            'artifact_sha256', 'manifest', 'entry_kind_counts', 'requested_paths',
            'integrity_contradictions', 'coverage', 'unexplored_branches']}
        paths = facts['requested_paths']
        if isinstance(paths, dict) and set(paths) == {'package.json', 'main.js', 'preload.js'}:
            if all(isinstance(rows, list) and all(isinstance(row, dict) and
                   row.get('logical_path') == name for row in rows)
                   for name, rows in paths.items()):
                paths = [row for rows in paths.values() for row in rows]
        if isinstance(paths, list) and all(isinstance(row, dict) and
                                          isinstance(row.get('logical_path'), str) for row in paths):
            paths = sorted(paths, key=lambda row: row['logical_path'])
        facts['requested_paths'] = paths
        contradictions = facts['integrity_contradictions']
        if isinstance(contradictions, dict) and set(contradictions) == {'inspection', 'inventory'}:
            if all(rows == [] for rows in contradictions.values()):
                facts['integrity_contradictions'] = []
        branches = facts['unexplored_branches']
        if isinstance(branches, list) and all(isinstance(row, dict) for row in branches):
            # Branch identity includes the source Evidence identity. Compare its
            # reported meaning here and verify its actual source reference below.
            facts['unexplored_branches'] = [{key: row.get(key) for key in [
                'reason', 'detail', 'next_probe']} for row in branches]
        return facts
    if task == 'firmware':
        result = value.get('result')
        if not isinstance(result, dict):
            result = {}
        engine = result.get('engine', result.get('provider'))
        if isinstance(engine, dict):
            engine = {'version': engine.get('version'),
                      'executable_sha256': engine.get('executable_sha256',
                                                    engine.get('engine_artifact_sha256'))}
        regions = result.get('regions')
        if isinstance(regions, list) and all(isinstance(row, dict) for row in regions):
            # Binwalk's UUID is run-local; preserve it in the answer but do not
            # compare it with the independent replay's different occurrence ID.
            selected_regions = []
            for row in regions:
                selected = {key: row.get(key) for key in [
                    'offset', 'signature', 'description', 'reported_confidence']}
                if 'reported_size' in row:
                    size = row['reported_size']
                elif 'reported_extent_bytes' in row:
                    size = row['reported_extent_bytes']
                else:
                    extent = row.get('reported_extent')
                    size = None
                    if isinstance(extent, dict) and extent.get('offset') == row.get('offset'):
                        length = extent.get('length')
                        offset = row.get('offset')
                        if isinstance(length, int) and isinstance(offset, int) and \
                                extent.get('end_exclusive') == offset + length:
                            size = length
                selected['reported_size'] = size
                selected_regions.append(selected)
            regions = selected_regions
        return {'artifact_sha256': value.get('artifact_sha256'),
                'engine': engine, 'input_size': result.get('input_size', result.get('input_size_bytes')),
                'regions': regions, 'coverage': result.get('coverage', result.get('examined_coverage'))}
    if task == 'managed':
        def selected(field, keys):
            row = value.get(field)
            return {key: required_field(row, key) for key in keys} if isinstance(row, dict) else row
        coverage = value.get('coverage')
        if isinstance(coverage, dict):
            coverage = {'managed_artifact': coverage.get('managed_artifact'),
                        'native_boundaries': coverage.get('native_boundaries',
                                                          coverage.get('managed_native_boundaries'))}
            coverage = {key: {field: row.get(field) for field in ['state', 'issues']}
                        if isinstance(row, dict) else row
                        for key, row in coverage.items() if key in ['managed_artifact', 'native_boundaries']}
        return {
            'artifact_sha256': value.get('artifact_sha256'),
            'assembly': selected('assembly', ['name', 'version']),
            'module': selected('module', ['name', 'mvid']),
            'classification': value.get('classification'),
            'target_frameworks': value.get('target_frameworks'),
            'native_boundaries': selected('native_boundaries', ['module_refs', 'pinvoke_imports']),
            'coverage': coverage,
        }
    facts = {field: value.get(field) for field in [
        'artifact_sha256', 'package_name', 'version_name', 'version_code', 'matches', 'onCreate']}
    methods = facts['onCreate']
    if isinstance(methods, list) and all(isinstance(row, dict) for row in methods):
        facts['onCreate'] = [{key: required_field(row, key) for key in [
            'reported_signature', 'overload_index', 'dex_descriptor']} for row in methods]
    return facts


def producer_ids(reply):
    if not isinstance(reply, dict):
        return set(), 0
    ids = evidence_ids(reply.get('evidence_id'))
    ids |= evidence_ids(reply.get('evidence_links'))
    for call in reply.get('calls', []):
        ids |= evidence_ids(call.get('evidence_id'))
        ids |= evidence_ids(call.get('evidence_links'))
        ids |= evidence_ids(call.get('partial_evidence_id'))
    unreadable = 0
    # SDK envelopes and Codex JSONL use distinct declared field spellings.
    for field in ['structuredContent', 'structured_content']:
        nested_ids, nested_unreadable = producer_ids(reply.get(field))
        ids |= nested_ids
        unreadable += nested_unreadable
    for content in reply.get('content', []):
        if content.get('type') != 'text':
            continue
        try:
            value = json.loads(content['text'])
        except ValueError:
            unreadable += 1
            continue
        nested_ids, nested_unreadable = producer_ids(value)
        ids |= nested_ids
        unreadable += nested_unreadable
    return ids, unreadable


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--trial', type=Path, required=True)
    parser.add_argument('--oracle', type=Path, required=True)
    parser.add_argument('--task', choices=[
        'android', 'managed', 'native', 'firmware', 'electron-inventory'], default='android')
    args = parser.parse_args()
    oracle = json.loads(args.oracle.read_text())
    if oracle.get('failure') or not oracle.get('projection'):
        raise SystemExit('A failed replay is not a factual oracle')
    projection = oracle['projection']
    if args.task == 'managed':
        projection = {**projection, 'coverage': {
            'managed_artifact': projection['coverage'],
            'native_boundaries': projection['native_boundaries']['coverage'],
        }}
    expected = requested_facts(projection, args.task)
    # A task explicitly chooses these assertions; do not grade unrequested fields.
    if any(value is None for value in expected.values()):
        raise SystemExit('Replay does not contain the selected task facts')
    failures = []
    answer_format = None
    answer_path = args.trial / 'answer.txt'
    try:
        answer, answer_format = read_answer(answer_path)
    except (FileNotFoundError, ValueError) as error:
        answer = {}
        failures.append({'kind': 'answer_parse_failure', 'reason': str(error)})
    actual_facts = requested_facts(answer, args.task)
    for field, wanted in expected.items():
        actual = actual_facts[field]
        if not same_fact(actual, wanted):
            failures.append({'kind': 'fact_mismatch', 'field': field,
                             'expected': wanted, 'actual': actual})
    observed = set()
    unreadable = 0
    for line in (args.trial / 'events.jsonl').read_text().splitlines():
        event = json.loads(line)
        item = event.get('item', {})
        if event.get('type') != 'item.completed' or item.get('type') != 'mcp_tool_call':
            continue
        # Only producer envelopes and bridge audit IDs establish retention.
        ids, skipped = producer_ids(item.get('result') or {})
        observed |= ids
        unreadable += skipped
    cited = evidence_ids(answer.get('evidence_ids'))
    if args.task == 'electron-inventory':
        for branch in answer.get('unexplored_branches', []):
            if isinstance(branch, dict):
                cited |= evidence_ids(branch.get('evidence_id'))
    if not cited:
        failures.append({'kind': 'missing_evidence_references'})
    if cited - observed:
        failures.append({'kind': 'unobserved_evidence_ids', 'ids': sorted(cited - observed)})
    result = {'task': args.task,
              'grader_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'scope': 'producer_fact_parity_and_reference_existence_not_runtime_accuracy',
              'passed': not failures, 'fact_assertions': len(expected),
              'answer_format': answer_format,
              'unreadable_result_texts': unreadable,
              'cited_evidence_ids': sorted(cited), 'failures': failures}
    (args.trial / 'grade.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
