import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import { kitsApi, searchBank } from '../../lib/kits-api';
import { userMessageForError } from '../../lib/errors';
import {
  KIT_TEMPLATES,
  templateFallbackBody,
  templateSettings,
  type KitTemplate,
} from '../../lib/kit-templates';

/**
 * /kits/new — template gallery (FR-E2-7, P1). Templates are client-side
 * definitions applied through the normal create APIs: create the kit, then
 * insert each question — cloned from the question bank when the template's
 * role-family query hits (provenance `bank`), inline fallback otherwise.
 */
export function TemplateGalleryPage() {
  const navigate = useNavigate();
  const [applying, setApplying] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string>();

  async function applyTemplate(template: KitTemplate) {
    setApplying(template.id);
    setError(undefined);
    try {
      setProgress('Creating kit…');
      const { kit } = await kitsApi.create({
        title: template.name,
        role: template.role,
        level: template.level,
        settings: templateSettings(template),
      });

      for (const [index, question] of template.questions.entries()) {
        setProgress(`Adding question ${index + 1} of ${template.questions.length}…`);
        let inserted = false;
        try {
          const bank = await searchBank({
            query: question.bankQuery,
            roleFamily: template.roleFamily,
          });
          const hit = bank.items[0];
          if (hit) {
            await kitsApi.cloneFromBank(kit.id, { bankItemId: hit.id });
            inserted = true;
          }
        } catch {
          inserted = false; // bank lookup failed — fall back to the inline body
        }
        if (!inserted) {
          await kitsApi.addQuestion(kit.id, templateFallbackBody(question));
        }
      }

      navigate(`/kits/${kit.id}`, { state: { templateApplied: template.name } });
    } catch (err) {
      setError(userMessageForError(err));
      setApplying(null);
      setProgress('');
    }
  }

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8">
        <Link
          to="/kits"
          className="text-primary font-label-bold text-sm inline-flex items-center gap-1 hover:underline mb-4"
        >
          <Icon name="arrow_back" className="text-sm" /> Back to kits
        </Link>
        <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
          Start from a template
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
          Role-family starters prefill a draft kit with proven questions from the bank — edit
          everything after applying.
        </p>
      </section>

      {error && (
        <Card className="mb-6 border-error/40 bg-[#fff5f5] flex items-center gap-3" padding="md">
          <Icon name="error" className="text-error" />
          <p className="text-sm text-error font-label-bold">{error}</p>
        </Card>
      )}

      {applying && (
        <Card className="mb-6 flex items-center gap-3" padding="md" role="status">
          <Icon name="progress_activity" className="animate-spin text-primary" />
          <p className="text-sm text-on-surface-variant">Applying template — {progress}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Blank kit escape hatch */}
        <Card className="border-dashed border-2 border-outline-variant bg-transparent shadow-none flex flex-col items-center justify-center text-center min-h-[220px]">
          <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center mb-3">
            <Icon name="add" className="text-2xl text-primary" />
          </div>
          <h3 className="font-headline-sm text-headline-sm text-primary">Blank kit</h3>
          <p className="text-sm text-on-surface-variant mt-1 mb-4">Start from an empty draft.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/kits?create=1')}>
            Start blank
          </Button>
        </Card>

        {KIT_TEMPLATES.map((template) => (
          <Card key={template.id} className="flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Icon name={template.icon} className="text-primary" />
              </div>
              <span className="text-xs font-label-bold text-on-surface-variant bg-surface-container-high px-2.5 py-1 rounded-full">
                {template.questions.length} questions
              </span>
            </div>
            <h3 className="font-headline-sm text-headline-sm text-primary">{template.name}</h3>
            <p className="text-sm text-on-surface-variant mt-1 flex-1">{template.description}</p>
            <div className="mt-4 flex items-center gap-2 text-xs text-on-surface-variant">
              <Icon
                name={
                  template.mode === 'text' ? 'chat' : template.mode === 'voice' ? 'mic' : 'videocam'
                }
                className="text-sm"
              />
              <span className="capitalize">{template.mode}</span>
              <span aria-hidden="true">·</span>
              <span>{template.level}</span>
            </div>
            <Button
              className="mt-5 w-full"
              icon="bolt"
              loading={applying === template.id}
              disabled={applying !== null}
              onClick={() => void applyTemplate(template)}
            >
              Use this template
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
