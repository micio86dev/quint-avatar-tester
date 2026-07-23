// sortable.ts — minimal, dependency-free drag & drop reordering for a list.
//
// One reusable mechanism for every admin list that needs manual ordering. Attach
// it once to a container element; it uses event delegation, so the container may
// re-render its children freely without re-binding.
//
// Each reorderable child must carry:
//   - draggable="true"
//   - data-sortable-item
//   - data-sortable-key="<stable id>"   (returned, in the new order, to onReorder)
//
// On drop, onReorder receives the child keys in their new visual order. The caller
// owns the source-of-truth state and typically re-renders from it.

export interface SortableOptions {
  /** Called with the child keys in their new order after a drop. */
  onReorder: (orderedKeys: string[]) => void;
  /** Class toggled on the item being dragged (default 'sortable-dragging'). */
  draggingClass?: string;
}

const ITEM = '[data-sortable-item]';

// Find the sibling the dragged item should be inserted before, based on the
// pointer's vertical position. Returns null to append at the end.
function afterElement(container: HTMLElement, y: number, draggingClass: string): Element | null {
  const items = [...container.querySelectorAll<HTMLElement>(`${ITEM}:not(.${draggingClass})`)];
  let closest: { offset: number; element: Element | null } = {
    offset: Number.NEGATIVE_INFINITY,
    element: null,
  };
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}

export function makeSortable(container: HTMLElement, opts: SortableOptions): void {
  const draggingClass = opts.draggingClass ?? 'sortable-dragging';
  let dragging: HTMLElement | null = null;

  container.addEventListener('dragstart', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM);
    if (!item || !container.contains(item)) return;
    dragging = item;
    item.classList.add(draggingClass);
    // Firefox needs data set for the drag to start; effect keeps the move cursor.
    e.dataTransfer?.setData('text/plain', item.dataset.sortableKey ?? '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault(); // required to allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const after = afterElement(container, e.clientY, draggingClass);
    if (after == null) container.appendChild(dragging);
    else if (after !== dragging) container.insertBefore(dragging, after);
  });

  container.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const keys = [...container.querySelectorAll<HTMLElement>(ITEM)]
      .map((el) => el.dataset.sortableKey)
      .filter((k): k is string => k != null);
    opts.onReorder(keys);
  });

  container.addEventListener('dragend', () => {
    dragging?.classList.remove(draggingClass);
    dragging = null;
  });
}
