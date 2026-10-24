// Run with:  node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/schema.js');
const cyber = require('../schemas/cyber.json');

const ids = list => list.map(x => x.id);
const section = id => cyber.sections.find(s => s.id === id);

test('the cyber form is well formed', () => {
  assert.deepEqual(F.validateSchema(cyber), []);
});

test('the risk and analytics section only shows when the client agreed', () => {
  assert.ok(!ids(F.visibleSections(cyber, { country: 'GB', industry: 'retail', analytics: false })).includes('analytics'));
  assert.ok(ids(F.visibleSections(cyber, { country: 'GB', industry: 'retail', analytics: true })).includes('analytics'));
});

test('country, region and industry choose the questions', () => {
  const privacy = section('privacy');
  const ukShop = ids(F.visibleQuestions(cyber, privacy, { country: 'GB', industry: 'retail' }, {}));
  assert.ok(ukShop.includes('gdpr') && ukShop.includes('pci'));
  assert.ok(!ukShop.includes('ccpa') && !ukShop.includes('hipaa'));
  const usHospital = ids(F.visibleQuestions(cyber, privacy, { country: 'US', industry: 'healthcare' }, {}));
  assert.ok(usHospital.includes('ccpa') && usHospital.includes('hipaa'));
  assert.ok(!usHospital.includes('gdpr'));
});

test('follow-up questions show only after the right answer', () => {
  const claims = section('claims');
  const ctx = { country: 'GB', industry: 'technology' };
  assert.ok(!ids(F.visibleQuestions(cyber, claims, ctx, { had_incident: 'no' })).includes('incident_detail'));
  assert.ok(ids(F.visibleQuestions(cyber, claims, ctx, { had_incident: 'yes' })).includes('incident_detail'));
});

test('checkAnswers finds missing and bad answers, and ignores hidden questions', () => {
  const exposure = section('exposure');
  const ctx = { country: 'GB', industry: 'technology' };
  const problems = F.checkAnswers(cyber, exposure, ctx, { revenue_total: 1000, revenue_next: 'abc', revenue_online: 150 });
  const byId = Object.fromEntries(problems.map(p => [p.question, p.error]));
  assert.equal(byId.revenue_next, 'Please enter a number');
  assert.equal(byId.revenue_online, 'Please enter 0 to 100');
  assert.equal(byId.employees, 'Please answer this');
  assert.ok(!('records_phi' in byId)); // healthcare only
});

test('cleanAnswers drops answers to questions that are now hidden', () => {
  const claims = section('claims');
  const out = F.cleanAnswers(cyber, claims, { country: 'GB', industry: 'technology' }, { had_incident: 'no', incident_detail: 'old text' });
  assert.deepEqual(out, { had_incident: 'no' });
});

test('validateSchema catches common mistakes', () => {
  const bad = JSON.parse(JSON.stringify(cyber));
  bad.sections[0].questions.push({ id: 'legal_name', label: 'x', type: 'text' });
  bad.sections[1].questions.push({ id: 'pick', label: 'x', type: 'select' });
  bad.sections[2].questions.unshift({ id: 'early', label: 'x', type: 'text', showIf: { answer: { question: 'mfa_email', equals: 'yes' } } });
  bad.sections[3].questions.push({ id: 'odd', label: 'x', type: 'slider' });
  const errors = F.validateSchema(bad).join('\n');
  assert.match(errors, /legal_name: duplicate id/);
  assert.match(errors, /pick: needs options/);
  assert.match(errors, /early: depends on a question that is not earlier/);
  assert.match(errors, /odd: unknown type slider/);
});
