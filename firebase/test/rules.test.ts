import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-mailops',
    firestore: {
      rules: readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'),
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), { email: 'alice@example.com' });
    await setDoc(doc(db, 'users/alice/rules/r1'), { label: 'Newsletters', trashAfterDays: 30 });
    await setDoc(doc(db, 'users/bob/rules/r1'), { label: 'Receipts', neverDelete: true });
    await setDoc(doc(db, 'connectorTokens/abc'), { uid: 'alice' });
  });
});

describe('own data', () => {
  it('a signed-in user can read their own profile and rules', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'users/alice')));
    await assertSucceeds(getDoc(doc(db, 'users/alice/rules/r1')));
    await assertSucceeds(getDocs(collection(db, 'users/alice/rules')));
  });

  it('a signed-in user cannot write their own data from the client', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/rules/r2'), { label: 'Sneaky' }));
    await assertFails(setDoc(doc(db, 'users/alice'), { email: 'x@example.com' }));
    await assertFails(deleteDoc(doc(db, 'users/alice/rules/r1')));
  });
});

describe("other users' data", () => {
  it('cannot be read', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'users/bob/rules/r1')));
    await assertFails(getDocs(collection(db, 'users/bob/rules')));
  });

  it('cannot be written', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/bob/rules/r9'), { label: 'Injected' }));
  });
});

describe('unauthenticated access', () => {
  it('is denied everywhere', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users/alice')));
    await assertFails(getDoc(doc(db, 'users/alice/rules/r1')));
  });
});

describe('server-only collections', () => {
  it('token collections are closed to every client', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'connectorTokens/abc')));
    await assertFails(setDoc(doc(db, 'mcpTokens/def'), { uid: 'alice' }));
  });
});
