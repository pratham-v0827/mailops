'use client';

import Link from 'next/link';
import { AppShell, Card } from '../../components/AppShell';
import { Notice, PageHeader } from '../../components/ui';

const TEMPLATE_URL = process.env.NEXT_PUBLIC_ENGINE_TEMPLATE_URL ?? '';
const REPO = 'https://github.com/pratham-v0827/mailops';

export default function SetupPage() {
  return (
    <AppShell>
      <Setup />
    </AppShell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-white dark:text-slate-900">
        {n}
      </span>
      <div className="space-y-1 pb-2 text-sm">
        <p className="font-medium">{title}</p>
        <div className="text-slate-600 dark:text-slate-300">{children}</div>
      </div>
    </li>
  );
}

function Setup() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Set up MailOps for a Gmail account"
        subtitle="About 5 minutes. Repeat for each Gmail account you want to manage."
      />
      <Notice>
        MailOps does the Gmail work with a small Apps Script that runs{' '}
        <b>in your own Google account</b>. This website never gets access to your email: it only
        stores your rules, settings and the counts the script reports.
      </Notice>

      <Card title="Install">
        <ol className="space-y-4">
          <Step n={1} title="Open the MailOps engine template">
            {TEMPLATE_URL ? (
              <a
                href={TEMPLATE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                Open the template in Apps Script ↗
              </a>
            ) : (
              <>
                This instance has no template link yet. Create a new project at{' '}
                <a
                  href="https://script.new"
                  className="text-blue-600 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  script.new
                </a>{' '}
                and copy in the files from{' '}
                <a
                  href={`${REPO}/tree/main/engine/src`}
                  className="text-blue-600 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  engine/src
                </a>{' '}
                (or use <code>clasp push</code>, see the engine README).
              </>
            )}{' '}
            Sign in with the Gmail account you want to manage.
          </Step>
          <Step n={2} title="Make your own copy">
            On the project’s <b>Overview</b> page (ⓘ in the left bar), click <b>Make a copy</b>.
            Work in the copy (its name starts with “Copy of”).
          </Step>
          <Step n={3} title="Run setup">
            In the copy’s editor, pick <code>setup</code> in the function list next to <b>Debug</b>{' '}
            and click <b>Run</b>. Google asks for permission: <b>Review permissions</b> → your
            account → <b>Advanced</b> → <b>Go to … (unsafe)</b> → tick everything → <b>Allow</b>.
            (“Unsafe” only means Google hasn’t reviewed <i>your</i> private copy.)
          </Step>
          <Step n={4} title="Approve the code">
            The execution log shows a link like <code>…/pair?code=ABCD-EFGH</code>. Open it, check
            the Gmail address, and click <b>Approve and connect</b>. Setup finishes by itself.
          </Step>
          <Step n={5} title="Add rules and preview">
            Add or import{' '}
            <Link href="/rules" className="text-blue-600 hover:underline">
              rules
            </Link>
            , then click <b>Start dry run</b> on the{' '}
            <Link href="/dashboard" className="text-blue-600 hover:underline">
              Overview
            </Link>
            . Check the{' '}
            <Link href="/activity" className="text-blue-600 hover:underline">
              Activity
            </Link>{' '}
            page, and turn on production in{' '}
            <Link href="/settings" className="text-blue-600 hover:underline">
              Settings
            </Link>{' '}
            when you’re happy.
          </Step>
        </ol>
      </Card>

      <Card title="Permissions the script asks for, and why">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>
            <b>Read, compose and send email / manage labels</b> (gmail.modify): archive, move to
            Trash and label mail. Messages are read as metadata only (labels, date, sender,
            subject).
          </li>
          <li>
            <b>Manage basic mail settings</b> (gmail.settings.basic): create the filters you
            approve.
          </li>
          <li>
            <b>Connect to an external service</b>: talk to this dashboard.
          </li>
          <li>
            <b>Run when you’re not present</b>: the nightly pass and 15-minute sync.
          </li>
          <li>
            <b>Send email as you</b>: alerts to yourself when a run fails.
          </li>
          <li>
            <b>See your email address</b>: proves to the dashboard which Gmail account the script
            runs in.
          </li>
        </ul>
      </Card>

      <Card title="Already using the Sheet-based MailOps (v2)?">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Install the new engine as above and keep the old one in dry run (or with its triggers
          removed) while you compare. Import your rules on the Rules page. Run only one engine in
          production per Gmail account.
        </p>
      </Card>
    </div>
  );
}
