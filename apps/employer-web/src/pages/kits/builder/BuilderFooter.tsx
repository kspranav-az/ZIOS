import type { DurationEstimateResponse, Kit } from '@zios/shared-types';
import { Button, Icon } from '@zios/ui';
import { formatSeconds } from '../../../lib/kit-utils';

/**
 * Sticky builder footer: live duration estimate vs the kit cap, publish and
 * archive actions (FR-E2-1, FR-E2-5).
 */

interface BuilderFooterProps {
  kit: Kit;
  estimate: DurationEstimateResponse | null;
  publishing: boolean;
  archiving: boolean;
  onPublish: () => void;
  onArchiveToggle: () => void;
}

export function BuilderFooter({
  kit,
  estimate,
  publishing,
  archiving,
  onPublish,
  onArchiveToggle,
}: BuilderFooterProps) {
  const archived = kit.status === 'archived';
  const ratio =
    estimate && estimate.capSeconds > 0
      ? Math.min(1, estimate.estimatedSeconds / estimate.capSeconds)
      : 0;

  return (
    <footer className="fixed bottom-0 left-0 right-0 lg:left-64 z-40 bg-surface-container-lowest/95 backdrop-blur border-t border-surface-variant/60">
      <div className="max-w-container-max mx-auto px-4 sm:px-8 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Duration estimate vs cap */}
        <div className="flex-1 min-w-0">
          {estimate ? (
            <div>
              <div className="flex items-center gap-2 text-xs">
                <Icon name="schedule" className="text-base text-on-surface-variant" />
                <span className="font-label-bold text-on-surface">
                  Estimated {formatSeconds(estimate.estimatedSeconds)}
                </span>
                <span className="text-on-surface-variant">
                  of {formatSeconds(estimate.capSeconds)} cap · {estimate.questionCount}{' '}
                  {estimate.questionCount === 1 ? 'question' : 'questions'}
                </span>
                <span
                  className={`font-label-bold px-2 py-0.5 rounded-full ${
                    estimate.withinCap ? 'bg-green-100 text-green-700' : 'bg-error/10 text-error'
                  }`}
                  role="status"
                >
                  {estimate.withinCap ? 'Within cap' : 'Over cap'}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full max-w-md bg-surface-container rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    estimate.withinCap ? 'bg-primary-container' : 'bg-error'
                  }`}
                  style={{ width: `${Math.max(2, ratio * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="text-xs text-on-surface-variant inline-flex items-center gap-1">
              <Icon name="schedule" className="text-base" /> Estimating duration…
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!archived && (
            <Button
              icon="publish"
              loading={publishing}
              onClick={onPublish}
              data-testid="publish-kit"
            >
              {kit.status === 'published' ? 'Publish new version' : 'Publish'}
            </Button>
          )}
          <Button
            variant={archived ? 'outline' : 'ghost'}
            icon={archived ? 'unarchive' : 'archive'}
            loading={archiving}
            onClick={onArchiveToggle}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      </div>
    </footer>
  );
}
