import { Icon } from '@zios/ui';

export function InterviewerBubble({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
        <Icon name="smart_toy" className="text-xl text-on-primary" />
      </div>
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">
          Interviewer
        </p>
        <p className="mt-1 text-body-lg text-on-surface">{text}</p>
      </div>
    </div>
  );
}
