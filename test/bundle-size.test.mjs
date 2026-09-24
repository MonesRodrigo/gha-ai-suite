import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBudget, renderMarkdown, summarize } from '../actions/bundle-size/bundle-size.mjs'

test('parseBudget accepts positive numbers', () => {
  assert.equal(parseBudget('250'), 250)
  assert.equal(parseBudget('0.5'), 0.5)
})

test('parseBudget rejects values that would disable the gate', () => {
  for (const value of ['', undefined, 'abc', '0', '-1', 'Infinity']) {
    assert.throws(() => parseBudget(value), /positive number/, `accepted ${value}`)
  }
})

const files = [
  { path: 'app.js', ext: '.js', gz: 3000 },
  { path: 'chunk.mjs', ext: '.mjs', gz: 1000 },
  { path: 'app.css', ext: '.css', gz: 1024 },
  { path: 'index.html', ext: '.html', gz: 50_000 },
]

test('budgets JS and CSS but not HTML', () => {
  const summary = summarize(files, 5)
  assert.deepEqual(summary.totals, { js: 4000, css: 1024, html: 50_000 })
  assert.equal(summary.assets, 5024)
  assert.equal(summary.overBudget, false)
  assert.deepEqual(summary.top.map((f) => f.path), ['app.js', 'app.css', 'chunk.mjs'])
})

test('flags assets over the budget', () => {
  assert.equal(summarize(files, 4.9).overBudget, true)
})

test('renders the verdict in the report', () => {
  assert.match(renderMarkdown(summarize(files, 4.9), 4.9), /Over budget/)
  assert.match(renderMarkdown(summarize(files, 5), 5), /Within budget/)
})
