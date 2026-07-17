import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KitQuestion, UpdateQuestionBody } from '@zios/shared-types';
import { restrictToVerticalAxis } from './dnd-modifiers';
import { serializeQuestionOrder } from '../../../lib/kit-utils';
import { QuestionCard } from './QuestionCard';

/**
 * Drag-and-drop question list (FR-E2-1): dnd-kit sortable; on drop the FULL
 * new order is serialized and posted to the backend's reorder contract
 * (every id exactly once — the server rebases fractional positions).
 */

interface SortableQuestionListProps {
  questions: KitQuestion[];
  topics: string[];
  disabled: boolean;
  savingIds: ReadonlySet<string>;
  publishErrorIndexes: ReadonlySet<number>;
  lastAddedId: string | null;
  onPatch: (questionId: string, patch: UpdateQuestionBody) => void;
  onDelete: (questionId: string) => void;
  onReorder: (questionIds: string[]) => void;
}

export function SortableQuestionList({
  questions,
  topics,
  disabled,
  savingIds,
  publishErrorIndexes,
  lastAddedId,
  onPatch,
  onDelete,
  onReorder,
}: SortableQuestionListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = questions.findIndex((q) => q.id === active.id);
    const toIndex = questions.findIndex((q) => q.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...questions];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved!);
    onReorder(serializeQuestionOrder(next));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-3">
          {questions.map((question, index) => (
            <SortableQuestionCard
              key={question.id}
              question={question}
              index={index}
              topics={topics}
              disabled={disabled}
              saving={savingIds.has(question.id)}
              hasPublishError={publishErrorIndexes.has(index + 1)}
              defaultExpanded={question.id === lastAddedId}
              onPatch={onPatch}
              onDelete={onDelete}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableQuestionCard(
  props: Omit<
    Parameters<typeof QuestionCard>[0],
    'wrapperRef' | 'wrapperStyle' | 'dragHandleProps'
  >,
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.question.id,
    disabled: props.disabled,
  });

  return (
    <li>
      <QuestionCard
        {...props}
        wrapperRef={setNodeRef}
        wrapperStyle={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.85 : undefined,
          zIndex: isDragging ? 10 : undefined,
          position: 'relative',
        }}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </li>
  );
}
