import test from 'node:test';
import assert from 'node:assert/strict';
import { q, qRun, qOne, tx } from '../src/lib/db.ts';

test('database helper q, qRun, tx, and json parsing', () => {
  const invId = `test_inv_${Date.now()}`;
  const nodeId = `test_node_${Date.now()}`;

  tx(() => {
    qRun(
      `INSERT INTO investigations (id, title, root_subject, version, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      invId,
      'Stripe Analysis',
      'Stripe',
      1,
      new Date().toISOString(),
      new Date().toISOString()
    );

    qRun(
      `INSERT INTO graph_nodes (id, investigation_id, canonical_key, type, label, properties, version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      nodeId,
      invId,
      'stripe',
      'company',
      'Stripe',
      JSON.stringify({ valuation: '65B', isRoot: true }),
      1,
      new Date().toISOString()
    );
  });

  const inv = qOne<{ id: string; title: string }>(
    'SELECT * FROM investigations WHERE id = $1',
    invId
  );
  assert.ok(inv, 'Investigation record exists');
  assert.equal(inv.title, 'Stripe Analysis');

  const node = qOne<{ id: string; properties: any }>(
    'SELECT * FROM graph_nodes WHERE id = $1',
    nodeId
  );
  assert.ok(node, 'Graph node exists');
  assert.equal(node.properties.valuation, '65B');
  assert.equal(node.properties.isRoot, true);
});
