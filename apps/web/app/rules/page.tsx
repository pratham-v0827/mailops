'use client';

import { Rule } from '@mailops/schema';
import { useMemo, useState } from 'react';
import { AppShell, Card } from '../../components/AppShell';
import { useMailboxes } from '../../components/MailboxProvider';
import {
  Badge,
  Button,
  Empty,
  errorText,
  inputCls,
  Modal,
  Notice,
  PageHeader,
  Table,
  useMailboxResource,
  when,
  WithMailbox,
} from '../../components/ui';
import type { LabelsResponse, MailboxView, RulesResponse } from '../../lib/api-types';

type RuleRow = RulesResponse['rules'][number];

export default function RulesPage() {
  return (
    <AppShell>
      <WithMailbox>{(m) => <Rules mailbox={m} />}</WithMailbox>
    </AppShell>
  );
}

const days = (v: number | null) => (v === null ? '—' : `${v} d`);

function inPreview(r: RuleRow, hours: number) {
  return !!r.changedAt && hours > 0 && Date.now() - new Date(r.changedAt).getTime() < hours * 36e5;
}

function Rules({ mailbox }: { mailbox: MailboxView }) {
  const { data, error, reload, base, api } = useMailboxResource<RulesResponse>('/rules');
  const labels = useMailboxResource<LabelsResponse>('/labels');
  const { reload: reloadMailboxes } = useMailboxes();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<RuleRow | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const previewHours = mailbox.settings.newRulePreviewHours;

  const rules = useMemo(() => data?.rules ?? [], [data]);
  const shown = useMemo(
    () => rules.filter((r) => r.label.toLowerCase().includes(filter.toLowerCase())),
    [rules, filter],
  );
  const missing = useMemo(() => {
    const names = new Set((labels.data?.labels ?? []).map((l) => l.name));
    return labels.data?.labels.length
      ? new Set(rules.filter((r) => !names.has(r.label)).map((r) => r.id))
      : new Set<string>();
  }, [labels.data, rules]);

  const changed = () => {
    void reload();
    void reloadMailboxes();
  };

  if (error) return <Notice tone="bad">{error.message}</Notice>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules"
        subtitle={`${rules.length} rules · one per Gmail label: archive after N days, move to Trash after M days, or keep`}
      >
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter labels…"
          className={`${inputCls} w-56`}
        />
        <Button onClick={() => setEditing('new')}>Add rule</Button>
        {rules.length === 0 && (
          <Button kind="secondary" onClick={() => setShowImport(true)}>
            Import
          </Button>
        )}
      </PageHeader>

      {previewHours > 0 && (
        <p className="text-xs text-slate-500">
          New or changed rules run as a preview for {previewHours} h before they archive or trash
          anything, even in production.
        </p>
      )}

      {rules.length === 0 ? (
        <Empty>
          No rules yet. Add one, or import a JSON export (for example from the MailOps Sheet).
        </Empty>
      ) : (
        <Table head={['Label', 'Archive after', 'Trash after', 'Protections', 'Changed', '']}>
          {shown.map((r) => (
            <tr key={r.id} className={r.enabled ? '' : 'opacity-50'}>
              <td className="font-medium">
                {r.label} {!r.enabled && <Badge>off</Badge>}{' '}
                {inPreview(r, previewHours) && <Badge tone="info">preview</Badge>}{' '}
                {missing.has(r.id) && <Badge tone="warn">label missing in Gmail</Badge>}
              </td>
              <td>{days(r.archiveAfterDays)}</td>
              <td>
                {r.neverDelete ? <Badge tone="good">never delete</Badge> : days(r.trashAfterDays)}
              </td>
              <td className="text-xs text-slate-500">
                {[r.protectUnread && 'unread', r.protectStarred && 'starred']
                  .filter(Boolean)
                  .join(', ') || '—'}
              </td>
              <td className="text-xs text-slate-500" title={r.changedBy ?? ''}>
                {when(r.changedAt)}
              </td>
              <td className="text-right">
                <Button kind="link" onClick={() => setEditing(r)}>
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {editing && (
        <EditRule
          rule={editing === 'new' ? null : editing}
          labelNames={(labels.data?.labels ?? [])
            .filter((l) => l.type === 'user')
            .map((l) => l.name)}
          onClose={() => setEditing(null)}
          onSave={async (rule) => {
            await api(`${base}/rules`, { method: 'PUT', body: JSON.stringify(rule) });
            setEditing(null);
            changed();
          }}
        />
      )}
      {showImport && base && (
        <ImportRules
          base={base}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            changed();
          }}
        />
      )}
    </div>
  );
}

function EditRule({
  rule,
  labelNames,
  onClose,
  onSave,
}: {
  rule: RuleRow | null;
  labelNames: string[];
  onClose: () => void;
  onSave: (r: Rule) => Promise<void>;
}) {
  const [label, setLabel] = useState(rule?.label ?? '');
  const [archive, setArchive] = useState(rule?.archiveAfterDays?.toString() ?? '');
  const [trash, setTrash] = useState(rule?.trashAfterDays?.toString() ?? '');
  const [neverDelete, setNeverDelete] = useState(rule?.neverDelete ?? false);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [protectUnread, setProtectUnread] = useState(rule?.protectUnread ?? false);
  const [protectStarred, setProtectStarred] = useState(rule?.protectStarred ?? true);
  const [notes, setNotes] = useState(rule?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  async function save() {
    const parsed = Rule.safeParse({
      label,
      enabled,
      neverDelete,
      protectUnread,
      protectStarred,
      risk: rule?.risk ?? 'LOW',
      notes,
      archiveAfterDays: num(archive),
      trashAfterDays: neverDelete ? null : num(trash),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={rule ? 'Edit rule' : 'Add rule'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2 space-y-1">
          <span className="text-slate-500">Gmail label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!!rule}
            list="label-names"
            placeholder="Newsletters/Weekly"
            className={`${inputCls} disabled:opacity-60`}
          />
          <datalist id="label-names">
            {labelNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1">
          <span className="text-slate-500">Archive after (days)</span>
          <input
            value={archive}
            onChange={(e) => setArchive(e.target.value)}
            inputMode="numeric"
            placeholder="blank = never"
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-500">Move to Trash after (days)</span>
          <input
            value={neverDelete ? '' : trash}
            disabled={neverDelete}
            onChange={(e) => setTrash(e.target.value)}
            inputMode="numeric"
            placeholder={neverDelete ? 'never' : 'blank = never'}
            className={`${inputCls} disabled:opacity-50`}
          />
        </label>
        {[
          ['Never delete (keep forever)', neverDelete, setNeverDelete],
          ['Keep unread mail in the inbox and out of Trash', protectUnread, setProtectUnread],
          ['Never move starred mail to Trash', protectStarred, setProtectStarred],
          ['Enabled', enabled, setEnabled],
        ].map(([text, value, set]) => (
          <label key={text as string} className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
            />
            {text as string}
          </label>
        ))}
        <label className="col-span-2 space-y-1">
          <span className="text-slate-500">Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy || !label.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

function ImportRules({
  base,
  onClose,
  onDone,
}: {
  base: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useMailboxResource<unknown>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    setBusy(true);
    setMessage('');
    try {
      const body = JSON.parse(text);
      await api(`${base}/rules/import`, {
        method: 'POST',
        body: JSON.stringify(Array.isArray(body) ? { rules: body } : body),
      });
      onDone();
    } catch (e) {
      setMessage(e instanceof SyntaxError ? 'That is not valid JSON.' : errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Import rules" onClose={onClose}>
      <Card title="From a file">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          A JSON array of rules, or <code>{'{ "rules": [...] }'}</code>. Imported rules start in
          their preview period.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
          className="mt-3 block text-sm"
        />
      </Card>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder='[{ "label": "Newsletters", "archiveAfterDays": 1, "trashAfterDays": 15 }]'
        className={`${inputCls} mt-3 font-mono text-xs`}
      />
      {message && <p className="mt-2 text-sm text-red-600">{message}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !text.trim()}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </Modal>
  );
}
