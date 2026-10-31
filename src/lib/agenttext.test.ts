import { test } from "node:test";
import assert from "node:assert/strict";
import { agentText } from "./agenttext.ts";

test("agent results unwrap to plain passages", () => {
  const want = 'Mako: "Web-native model"\n\nTinySearch - Fast search';
  const passages = ['Mako: "Web-native model"', "TinySearch - Fast search"];
  assert.equal(agentText({ passages }), want);
  assert.equal(agentText({ result: JSON.stringify({ passages }) }), want); // the shape TinyFish actually returned
  assert.equal(agentText(JSON.stringify({ passages })), want);
  assert.equal(agentText({ result: "just a string" }), "just a string");
  assert.equal(agentText(null), "");
});
