'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@prisme/ui';
import { useEffect, useState } from 'react';
import { CaptureForm, type AreaChoice } from '@/app/(create)/create/capture/capture-form';
import { loadAreasForCapture } from './capture-areas';

/**
 * Capture, from anywhere, in under ten seconds.
 *
 * Mounted once in the app frame and opened from the command palette, so the
 * path is: ⌘K, "capture", type, Enter. Nothing navigates — the screen a
 * person was reading is still behind the dialog when it closes, which is what
 * makes capture cheap enough to actually do while in the middle of something
 * else.
 *
 * ## The areas load when it opens, not on every page
 *
 * The frame is on every screen, and fetching the area list on each of them to
 * populate a dialog nobody opened would be a request per page view. So the
 * list is fetched the first time the dialog opens and kept — areas change at
 * a yearly review, not between two captures.
 *
 * The form is the same component `/create/capture` renders. One capture box
 * with two mounts, because two that behave differently is two things to keep
 * working.
 */
export function CaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [areas, setAreas] = useState<readonly AreaChoice[] | null>(null);

  useEffect(() => {
    if (!open || areas !== null) return;
    let live = true;
    void loadAreasForCapture().then((loaded) => {
      if (live) setAreas(loaded);
    });
    return () => {
      live = false;
    };
  }, [open, areas]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Capture</DialogTitle>
          <DialogDescription>
            One line and an area. It becomes a task and stays one — decide what it is later.
          </DialogDescription>
        </DialogHeader>

        {areas === null ? (
          <p className="text-sm text-ink-secondary">Loading areas…</p>
        ) : (
          <CaptureForm
            areas={areas}
            onCaptured={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
