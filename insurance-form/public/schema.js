// Form definition logic: which sections and questions show, and whether answers are complete.
// Pure functions, shared by the browser and the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['text', 'textarea', 'number', 'currency', 'percent', 'date', 'select', 'multiselect', 'yesno', 'checkbox'];
  const CONDITION_KEYS = ['country', 'region', 'industry', 'analytics', 'answer'];

  // ctx = { country, industry, analytics }. Every key in showIf must match.
  function matches(showIf, schema, ctx, answers) {
    if (!showIf) return true;
    if (showIf.country && !showIf.country.includes(ctx.country)) return false;
    if (showIf.industry && !showIf.industry.includes(ctx.industry)) return false;
    if (showIf.region) {
      const c = schema.countries.find(x => x.code === ctx.country);
      if (!c || !showIf.region.includes(c.region)) return false;
    }
    if (showIf.analytics !== undefined && Boolean(ctx.analytics) !== showIf.analytics) return false;
    if (showIf.answer) {
      const v = (answers || {})[showIf.answer.question];
      if (v !== showIf.answer.equals) return false;
    }
    return true;
  }

  function visibleSections(schema, ctx) {
    return schema.sections.filter(s => matches(s.showIf, schema, ctx, null));
  }

  function visibleQuestions(schema, section, ctx, answers) {
    return section.questions.filter(q => matches(q.showIf, schema, ctx, answers));
  }

  function isEmpty(v) {
    return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
  }

  // Returns a list of { question, error } for one section's answers.
  function checkAnswers(schema, section, ctx, answers) {
    const problems = [];
    for (const q of visibleQuestions(schema, section, ctx, answers)) {
      const v = answers[q.id];
      if (isEmpty(v)) {
        if (q.required) problems.push({ question: q.id, error: 'Please answer this' });
        continue;
      }
      if (['number', 'currency', 'percent'].includes(q.type)) {
        const n = Number(v);
        if (!Number.isFinite(n)) problems.push({ question: q.id, error: 'Please enter a number' });
        else if (q.type === 'percent' && (n < 0 || n > 100)) problems.push({ question: q.id, error: 'Please enter 0 to 100' });
        else if (q.min !== undefined && n < q.min) problems.push({ question: q.id, error: 'Must be ' + q.min + ' or more' });
        else if (q.max !== undefined && n > q.max) problems.push({ question: q.id, error: 'Must be ' + q.max + ' or less' });
      }
      if (q.type === 'select' && !q.options.includes(v)) problems.push({ question: q.id, error: 'Please pick an option' });
      if (q.type === 'multiselect' && !v.every(x => q.options.includes(x))) problems.push({ question: q.id, error: 'Please pick from the list' });
    }
    return problems;
  }

  // Drops answers to questions that no longer show (for example after changing a yes to a no).
  function cleanAnswers(schema, section, ctx, answers) {
    const out = {};
    for (const q of visibleQuestions(schema, section, ctx, answers)) {
      if (!isEmpty(answers[q.id])) out[q.id] = answers[q.id];
    }
    return out;
  }

  // Checks a form definition is well formed. Returns a list of error strings.
  function validateSchema(schema) {
    const errors = [];
    if (!schema || typeof schema !== 'object') return ['Schema must be an object'];
    for (const k of ['id', 'version', 'title']) if (typeof schema[k] !== 'string' || !schema[k]) errors.push('Missing ' + k);
    if (!Array.isArray(schema.countries) || !schema.countries.length) errors.push('Missing countries');
    if (!Array.isArray(schema.industries) || !schema.industries.length) errors.push('Missing industries');
    if (!Array.isArray(schema.sections) || !schema.sections.length) return errors.concat('Missing sections');
    const sectionIds = new Set();
    for (const s of schema.sections) {
      const where = 'Section ' + (s.id || '?');
      if (!/^[a-z0-9_]+$/.test(s.id || '')) errors.push(where + ': id must be lower case letters, numbers or _');
      if (sectionIds.has(s.id)) errors.push(where + ': duplicate id');
      sectionIds.add(s.id);
      if (!s.title) errors.push(where + ': missing title');
      checkCondition(s.showIf, where, null, errors);
      if (!Array.isArray(s.questions) || !s.questions.length) { errors.push(where + ': no questions'); continue; }
      const qIds = new Set();
      for (const q of s.questions) {
        const qw = where + ', question ' + (q.id || '?');
        if (!/^[a-z0-9_]+$/.test(q.id || '')) errors.push(qw + ': id must be lower case letters, numbers or _');
        if (qIds.has(q.id)) errors.push(qw + ': duplicate id');
        if (!q.label) errors.push(qw + ': missing label');
        if (!TYPES.includes(q.type)) errors.push(qw + ': unknown type ' + q.type);
        if ((q.type === 'select' || q.type === 'multiselect') && !(Array.isArray(q.options) && q.options.length)) errors.push(qw + ': needs options');
        checkCondition(q.showIf, qw, qIds, errors);
        qIds.add(q.id);
      }
    }
    return errors;
  }

  function checkCondition(showIf, where, earlierQuestions, errors) {
    if (!showIf) return;
    for (const k of Object.keys(showIf)) if (!CONDITION_KEYS.includes(k)) errors.push(where + ': unknown condition ' + k);
    if (showIf.answer) {
      if (!earlierQuestions) errors.push(where + ': sections cannot depend on an answer');
      else if (!earlierQuestions.has(showIf.answer.question)) errors.push(where + ': depends on a question that is not earlier in the section');
    }
  }

  return { TYPES, matches, visibleSections, visibleQuestions, checkAnswers, cleanAnswers, validateSchema, isEmpty };
});
