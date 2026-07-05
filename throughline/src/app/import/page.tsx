import Link from 'next/link';
import { ImportForm } from '@/components/ImportForm';
import { FileUploadForm } from '@/components/FileUploadForm';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/coach" className="text-sm text-sky-300 hover:underline">
          ← Roster
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">Import training log</h1>
        <p className="text-sm text-slate-500">
          Paste a Google Sheets link to a weekly training log. Re-importing the same athlete updates
          their data (it won’t duplicate).
        </p>
      </div>

      <Card title="Upload files">
        <p className="mb-3 text-xs text-slate-500">
          Upload one or more training-log spreadsheets (.xlsx). Multiple formats are supported
          (weekly sheets or a flat daily log).
        </p>
        <FileUploadForm />
      </Card>

      <Card title="Or import from Google Sheets links">
        <ImportForm />
      </Card>

      <Card title="How it reads the sheet">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Each weekly tab (e.g. “April 11–17”) is parsed into days.</li>
          <li>
            Mileage ranges that Sheets turned into dates (e.g. “7-8” → a date) are reversed back to
            miles automatically.
          </li>
          <li>Average paces are pulled from the run descriptions when noted.</li>
          <li>Every row is stored verbatim first; runs become normalized activities.</li>
        </ul>
      </Card>
    </div>
  );
}
