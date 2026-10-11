"""Check requested JSON facts and real Evidence references against a replay oracle."""

import argparse
import json
from pathlib import Path


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
    if task == 'managed':
        def selected(field, keys):
            row = value.get(field)
            return {key: row.get(key) for key in keys} if isinstance(row, dict) else row
        return {
            'artifact_sha256': value.get('artifact_sha256'),
            'assembly': selected('assembly', ['name', 'version']),
            'module': selected('module', ['name', 'mvid']),
            'classification': value.get('classification'),
            'target_frameworks': value.get('target_frameworks'),
            'native_boundaries': selected('native_boundaries', ['module_refs', 'pinvoke_imports']),
            'coverage': value.get('coverage'),
        }
    facts = {field: value.get(field) for field in [
        'artifact_sha256', 'package_name', 'version_name', 'version_code', 'matches', 'onCreate']}
    methods = facts['onCreate']
    if isinstance(methods, list) and all(isinstance(row, dict) for row in methods):
        facts['onCreate'] = [{key: row.get(key) for key in [
            'reported_signature', 'overload_index', 'dex_descriptor']} for row in methods]
    return facts


def producer_ids(reply):
    if not isinstance(reply, dict):
        return set(), 0
    ids = evidence_ids(reply.get('evidence_id'))
    for call in reply.get('calls', []):
        ids |= evidence_ids(call.get('evidence_id'))
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
    parser.add_argument('--task', choices=['android', 'managed'], default='android')
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
        if actual != wanted:
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
    if not cited:
        failures.append({'kind': 'missing_evidence_references'})
    if cited - observed:
        failures.append({'kind': 'unobserved_evidence_ids', 'ids': sorted(cited - observed)})
    result = {'task': args.task,
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
