import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetId, exportUrlFor } from '../sheetImport';

test('parseSheetId extracts the file id from share links', () => {
  const id = '1LcE__CP51HsYdaZj0tEMKY8b6L4KIKSf';
  assert.equal(
    parseSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing&rtpof=true`),
    id,
  );
  assert.equal(parseSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(parseSheetId('https://example.com/not-a-sheet'), null);
  assert.equal(parseSheetId('garbage'), null);
});

test('exportUrlFor builds the xlsx export endpoint', () => {
  assert.equal(
    exportUrlFor('ABC123'),
    'https://docs.google.com/spreadsheets/d/ABC123/export?format=xlsx',
  );
});
