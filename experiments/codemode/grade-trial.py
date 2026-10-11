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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--trial', type=Path, required=True)
    parser.add_argument('--oracle', type=Path, required=True)
    args = parser.parse_args()
    oracle = json.loads(args.oracle.read_text())
    if oracle.get('failure') or not oracle.get('projection'):
        raise SystemExit('A failed replay is not a factual oracle')
    expected = oracle['projection']
    # A task explicitly chooses these assertions; do not grade unrequested fields.
    fields = ['artifact_sha256', 'package_name', 'version_name', 'version_code',
              'matches', 'onCreate']
    if not all(field in expected for field in fields):
        raise SystemExit('This grader currently supports the Android question only')
    failures = []
    answer_path = args.trial / 'answer.txt'
    try:
        answer = json.loads(answer_path.read_text())
        if not isinstance(answer, dict):
            raise ValueError('Answer is not a JSON object')
    except (FileNotFoundError, ValueError) as error:
        answer = {}
        failures.append({'kind': 'answer_parse_failure', 'reason': str(error)})
    for field in fields:
        wanted = expected[field]
        actual = answer.get(field)
        if field == 'onCreate':
            selected = ['reported_signature', 'overload_index', 'dex_descriptor']
            wanted = [{k: row[k] for k in selected} for row in wanted]
            if isinstance(actual, list) and all(isinstance(row, dict) for row in actual):
                actual = [{k: row.get(k) for k in selected} for row in actual]
        if actual != wanted:
            failures.append({'kind': 'fact_mismatch', 'field': field,
                             'expected': wanted, 'actual': actual})
    observed = set()
    for line in (args.trial / 'events.jsonl').read_text().splitlines():
        event = json.loads(line)
        item = event.get('item', {})
        if event.get('type') != 'item.completed' or item.get('type') != 'mcp_tool_call':
            continue
        result = item.get('result') or {}
        for content in result.get('content', []):
            if content.get('type') == 'text':
                try:
                    reply = json.loads(content['text'])
                except ValueError:
                    continue
                # Only producer IDs and bridge audit IDs establish retention.
                if isinstance(reply, dict):
                    observed |= evidence_ids(reply.get('evidence_id'))
                    for call in reply.get('calls', []):
                        observed |= evidence_ids(call.get('evidence_id'))
    cited = evidence_ids(answer.get('evidence_ids'))
    if not cited:
        failures.append({'kind': 'missing_evidence_references'})
    if cited - observed:
        failures.append({'kind': 'unobserved_evidence_ids', 'ids': sorted(cited - observed)})
    result = {'task': 'newpipe_package_and_MainActivity',
              'scope': 'producer_fact_parity_and_reference_existence_not_runtime_accuracy',
              'passed': not failures, 'fact_assertions': len(fields),
              'cited_evidence_ids': sorted(cited), 'failures': failures}
    (args.trial / 'grade.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
