"use client";

export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg p-6" role="alert">
      <h1 className="text-lg font-semibold">This view stopped working</h1>
      <p className="mt-1 text-sm text-muted">
        Something went wrong while drawing this page. Your recording is still open unless the
        browser ran out of memory.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-3 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-raised"
      >
        Try again
      </button>
    </div>
  );
}
