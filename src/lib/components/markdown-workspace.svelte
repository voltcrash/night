<script lang="ts">
	import { tick } from 'svelte';
	import { Copy, Download, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CloudOff, HardDrive, PanelLeft, PencilLine, X } from '@lucide/svelte';
	import { formatShortcut, HTML_SOURCE_SEPARATOR, PLAIN_TEXT_SEPARATOR, type KeyboardShortcuts, type PrimaryModifier, type TextBlock } from '$lib';
	import type { SourceLines } from '$lib/markdown';
	import { elementAnchors, scrollAnchors, syncedScrollTop, textAnchors, textareaAnchors, type ScrollAnchor } from '$lib/scroll-sync';
	import type { PaneEdge, PaneLayout, PaneOrder, SaveState, TransferState } from './app-types';
	import { outputViews, type OutputView } from './output-views';

	interface Props {
		storageNotice: string;
		storageError: string;
		outputPaneVisible: boolean;
		renderedPaneVisible: boolean;
		paneLayout: PaneLayout;
		paneOrder: PaneOrder;
		outputView: OutputView;
		plainText: string;
		plainTextBlocks: TextBlock[];
		htmlSource: string;
		htmlSourceBlocks: TextBlock[];
		renderedBlockLines: (SourceLines | undefined)[];
		renderedReadOnly: boolean;
		markdown: string;
		markdownLines: string[];
		liveLine: number;
		saveState: SaveState;
		transferState: TransferState;
		hasContent: boolean;
		renderedMarkdown: string;
		shortcuts: KeyboardShortcuts;
		primaryModifier: PrimaryModifier;
		editor?: HTMLTextAreaElement;
		liveEditorContainer?: HTMLDivElement;
		onRetryStorage: () => void;
		onDismissStorageNotice: () => void;
		onToggleSidebar: () => void;
		splitRatio: number;
		contentWidth: number;
		onToggleOutputPane: () => void;
		onOutputViewChange: (view: OutputView) => void;
		onCopy: () => void;
		onDownload: () => void;
		onToggleRenderedPane: () => void;
		onResize: (ratio: number) => void;
		onResizeEnd: () => void;
		onPlacePane: (pane: 'output' | 'rendered', edge: PaneEdge) => void;
		onReload: () => void;
		onMarkdownChange: (value: string) => void;
		onEditorBeforeInput: () => void;
		onEditorCopy: (event: ClipboardEvent) => void;
		onEditorCut: (event: ClipboardEvent) => void;
		onEditorPaste: (event: ClipboardEvent) => void;
		onSourceFocus: () => void;
		onLiveLineFocus: (line: number) => void;
		onRenderedInput: (event: InputEvent) => void;
		onRenderedLineKeydown: (event: KeyboardEvent) => void;
		renderEditableLine: (line: string, index: number) => string;
		liveLineKind: (line: string, index: number) => string;
		liveCodeLanguage: (index: number) => string;
	}

	let {
		storageNotice, storageError, outputPaneVisible, renderedPaneVisible, paneLayout, paneOrder, outputView, plainText, plainTextBlocks, htmlSource, htmlSourceBlocks, renderedBlockLines, renderedReadOnly, markdown, markdownLines, liveLine,
		saveState, transferState, hasContent, renderedMarkdown, shortcuts, primaryModifier,
		editor = $bindable(), liveEditorContainer = $bindable(), onRetryStorage, onDismissStorageNotice, onToggleSidebar,
		splitRatio, contentWidth, onToggleOutputPane, onOutputViewChange, onCopy, onDownload, onToggleRenderedPane, onResize, onResizeEnd, onPlacePane, onReload, onMarkdownChange, onEditorBeforeInput, onEditorCopy, onEditorCut, onEditorPaste, onSourceFocus, onLiveLineFocus, onRenderedInput,
		onRenderedLineKeydown, renderEditableLine, liveLineKind, liveCodeLanguage
	}: Props = $props();

	let shell = $state<HTMLElement>();
	let resizing = $state(false);
	let bothPanesVisible = $derived(outputPaneVisible && renderedPaneVisible);
	let stacked = $derived(paneLayout === 'rows');
	let swapped = $derived(paneOrder === 'rendered-first');
	// The divider handles follow the visual arrangement rather than a fixed pane.
	let firstPane = $derived(swapped ? 'page' : 'output');
	let secondPane = $derived(swapped ? 'output' : 'page');
	let firstPaneVisible = $derived(swapped ? renderedPaneVisible : outputPaneVisible);
	let secondPaneVisible = $derived(swapped ? outputPaneVisible : renderedPaneVisible);
	let toggleFirstPane = $derived(swapped ? onToggleRenderedPane : onToggleOutputPane);
	let toggleSecondPane = $derived(swapped ? onToggleOutputPane : onToggleRenderedPane);
	let towardsStart = $derived(stacked ? ChevronUp : ChevronLeft);
	let towardsEnd = $derived(stacked ? ChevronDown : ChevronRight);
	let activeView = $derived(outputViews.find((view) => view.id === outputView) ?? outputViews[0]);
	type LiveLineRect = { top: number; left: number; width: number; height: number };
	let liveLineRects = $state<LiveLineRect[]>([]);

	function isFenceLine(line: string): boolean {
		return /^\s*(?:`{3,}|~{3,})/.test(line);
	}

	function measureLiveLines(): void {
		if (!liveEditorContainer || renderedReadOnly) {
			liveLineRects = [];
			return;
		}
		const renderedContent = liveEditorContainer.querySelector<HTMLElement>('.live-rendered-content');
		if (!renderedContent) return;
		const containerRect = liveEditorContainer.getBoundingClientRect();
		const rects: Array<LiveLineRect | undefined> = Array.from({ length: markdownLines.length });
		const renderedBlocks = [...renderedContent.children] as HTMLElement[];

		renderedBlocks.forEach((block, blockIndex) => {
			const lines = renderedBlockLines[blockIndex];
			if (!lines) return;
			const start = Math.max(0, lines.start);
			const end = Math.min(markdownLines.length, lines.end);
			if (start >= end) return;
			const blockRect = block.getBoundingClientRect();
			const top = blockRect.top - containerRect.top;
			const left = blockRect.left - containerRect.left;
			const width = blockRect.width;
			const blockHeight = blockRect.height;
			const blockLines = markdownLines.slice(start, end);
			const contentLines = block.tagName === 'PRE' ? blockLines.filter((line) => !isFenceLine(line)) : [];

			if (contentLines.length) {
				const contentHeight = blockHeight / contentLines.length;
				let contentIndex = 0;
				blockLines.forEach((line, offset) => {
					const index = start + offset;
					if (isFenceLine(line)) {
						rects[index] = { top: offset === 0 ? top : top + blockHeight, left, width, height: 0 };
						return;
					}
					rects[index] = { top: top + contentIndex * contentHeight, left, width, height: contentHeight };
					contentIndex += 1;
				});
				return;
			}

			const lineHeight = blockHeight / (end - start);
			for (let index = start; index < end; index += 1) {
				rects[index] = { top: top + (index - start) * lineHeight, left, width, height: lineHeight };
			}
		});

		const contentWidth = renderedContent.getBoundingClientRect().width;
		liveLineRects = rects.map((rect) => rect ?? { top: 0, left: 0, width: contentWidth, height: 0 });
	}

	function liveLineStyle(index: number): string | undefined {
		const rect = liveLineRects[index];
		return rect
			? `top: ${rect.top}px; left: ${rect.left}px; width: ${rect.width}px; height: ${rect.height}px`
			: undefined;
	}

	function resizeTo(event: PointerEvent): void {
		const bounds = shell?.getBoundingClientRect();
		if (!bounds) return;
		const span = stacked ? bounds.height : bounds.width;
		if (!span) return;
		const offset = stacked ? event.clientY - bounds.top : event.clientX - bounds.left;
		onResize((offset / span) * 100);
	}

	function startResize(event: PointerEvent): void {
		if (!bothPanesVisible) return;
		event.preventDefault();
		resizing = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function trackResize(event: PointerEvent): void {
		if (resizing) resizeTo(event);
	}

	function endResize(event: PointerEvent): void {
		if (!resizing) return;
		resizing = false;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		onResizeEnd();
	}

	function nudgeResize(event: KeyboardEvent): void {
		if (!bothPanesVisible) return;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') onResize(splitRatio - 2);
		else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') onResize(splitRatio + 2);
		else if (event.key === 'Home' || event.key === 'End') onResize(event.key === 'Home' ? 20 : 80);
		else return;
		event.preventDefault();
		onResizeEnd();
	}

	function resetSplit(): void {
		if (!bothPanesVisible) return;
		onResize(50);
		onResizeEnd();
	}

	type Pane = 'output' | 'rendered';
	const DRAG_THRESHOLD = 5;
	const MOVE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
	const edgeKeys: Record<string, PaneEdge> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' };

	let outputPaneElement = $state<HTMLElement>();
	let renderedPaneElement = $state<HTMLElement>();
	let drag = $state<{ pane: Pane; pointerId: number; startX: number; startY: number; dx: number; dy: number; originX: number; originY: number; scale: number; edge: PaneEdge; moving: boolean }>();

	function paneEdge(pane: Pane): PaneEdge {
		const leads = (pane === 'rendered') === swapped;
		if (stacked) return leads ? 'top' : 'bottom';
		return leads ? 'left' : 'right';
	}

	// The moved pane keeps its share of the space, so the preview matches where it settles.
	let dropSlot = $derived.by(() => {
		if (!drag?.moving) return undefined;
		const size = paneEdge(drag.pane) === 'left' || paneEdge(drag.pane) === 'top' ? splitRatio : 100 - splitRatio;
		const horizontal = drag.edge === 'left' || drag.edge === 'right';
		return `--slot-left: ${drag.edge === 'right' ? 100 - size : 0}%; --slot-top: ${drag.edge === 'bottom' ? 100 - size : 0}%; --slot-width: ${horizontal ? size : 100}%; --slot-height: ${horizontal ? 100 : size}%`;
	});

	function nearestEdge(event: PointerEvent): PaneEdge {
		const bounds = shell!.getBoundingClientRect();
		const x = (event.clientX - bounds.left) / bounds.width;
		const y = (event.clientY - bounds.top) / bounds.height;
		const distances: [PaneEdge, number][] = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]];
		return distances.reduce((nearest, candidate) => (candidate[1] < nearest[1] ? candidate : nearest))[0];
	}

	function startPaneDrag(event: PointerEvent, pane: Pane): void {
		if (!bothPanesVisible || event.button !== 0 || drag) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		const bounds = (pane === 'output' ? outputPaneElement : renderedPaneElement)!.getBoundingClientRect();
		// The pane shrinks around the grab point, so it stays under the pointer and uncovers the drop slots.
		const scale = Math.min(0.7, 380 / bounds.width, 320 / bounds.height);
		drag = { pane, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, originX: event.clientX - bounds.left, originY: event.clientY - bounds.top, scale, edge: paneEdge(pane), moving: false };
	}

	function trackPaneDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.dx = event.clientX - drag.startX;
		drag.dy = event.clientY - drag.startY;
		if (!drag.moving && Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD) return;
		drag.moving = true;
		drag.edge = nearestEdge(event);
	}

	function endPaneDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const { pane, edge, moving } = drag;
		if (event.type === 'pointerup' && moving) void movePane(pane, edge);
		else if (moving) void movePane(pane, paneEdge(pane));
		else drag = undefined;
	}

	function cancelPaneDrag(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !drag?.moving) return;
		event.preventDefault();
		void movePane(drag.pane, paneEdge(drag.pane));
	}

	function nudgePane(event: KeyboardEvent, pane: Pane): void {
		const edge = edgeKeys[event.key];
		if (!edge || !bothPanesVisible) return;
		event.preventDefault();
		void movePane(pane, edge);
	}

	// Each pane glides from where it was drawn to its new track instead of jumping there.
	async function movePane(pane: Pane, edge: PaneEdge): Promise<void> {
		const panes = [outputPaneElement, renderedPaneElement].filter((element): element is HTMLElement => Boolean(element));
		const before = panes.map((element) => element.getBoundingClientRect());
		const moved = pane === 'output' ? outputPaneElement : renderedPaneElement;
		if (edge !== paneEdge(pane)) onPlacePane(pane, edge);
		drag = undefined;
		await tick();
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		panes.forEach((element, index) => {
			const from = before[index];
			const to = element.getBoundingClientRect();
			if (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1 && Math.abs(from.width - to.width) < 1 && Math.abs(from.height - to.height) < 1) return;
			// Clipping instead of scaling keeps the text laid out at its final size while the pane moves.
			const clipRight = Math.max(0, to.width - from.width);
			const clipBottom = Math.max(0, to.height - from.height);
			element.animate(
				[
					{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, clipPath: `inset(0 ${clipRight}px ${clipBottom}px 0 round 10px)`, zIndex: element === moved ? 8 : 7 },
					{ transform: 'none', clipPath: 'inset(0 0 0 0 round 0)', zIndex: element === moved ? 8 : 7 }
				],
				{ duration: 300, easing: MOVE_EASING }
			);
		});
		shell?.querySelector('.pane-divider')?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration: 300 });
	}

	// Scrolling either pane scrolls the other to the same part of the note.
	let outputBody = $state<HTMLElement>();
	let scrollDriver: Pane = 'rendered';
	let syncFrame = 0;
	const syncedTops = new WeakMap<Element, number>();

	function scrollerOf(pane: Pane): HTMLElement | undefined {
		if (pane === 'rendered') return renderedPaneElement;
		return (outputBody?.firstElementChild as HTMLElement | null) ?? undefined;
	}

	function proseAnchors(scroller: HTMLElement): ScrollAnchor[] {
		const article = scroller.querySelector('article.prose');
		return article ? elementAnchors(scroller, [...article.children].map((element, index) => [element, renderedBlockLines[index]])) : [];
	}

	function paneAnchors(pane: Pane, scroller: HTMLElement): ScrollAnchor[] {
		let points: ScrollAnchor[];
		if (pane === 'rendered') {
			points = !renderedReadOnly && liveEditorContainer
				? elementAnchors(
						scroller,
						[...liveEditorContainer.querySelectorAll<HTMLElement>('[data-live-line]')].map((element, index) => [element, { start: index, end: index + 1 }]),
					)
				: proseAnchors(scroller);
		} else if (scroller instanceof HTMLTextAreaElement) {
			points = textareaAnchors(scroller);
		} else if (outputView === 'text') {
			points = textAnchors(scroller, plainTextBlocks, PLAIN_TEXT_SEPARATOR);
		} else if (outputView === 'html') {
			points = textAnchors(scroller, htmlSourceBlocks, HTML_SOURCE_SEPARATOR);
		} else {
			points = proseAnchors(scroller);
		}
		return scrollAnchors(points, markdownLines.length, scroller.scrollHeight);
	}

	function syncScroll(from: Pane): void {
		const to: Pane = from === 'output' ? 'rendered' : 'output';
		const source = scrollerOf(from);
		const target = scrollerOf(to);
		if (!bothPanesVisible || !source || !target) return;
		const top = syncedScrollTop(
			{ anchors: paneAnchors(from, source), scrollTop: source.scrollTop, scrollHeight: source.scrollHeight, clientHeight: source.clientHeight },
			{ anchors: paneAnchors(to, target), scrollHeight: target.scrollHeight, clientHeight: target.clientHeight }
		);
		if (Math.abs(target.scrollTop - top) < 1) return;
		target.scrollTo({ top, behavior: 'instant' });
		// Browsers round the offset, so the echo is recognised by the value they settled on.
		syncedTops.set(target, target.scrollTop);
	}

	function queueScrollSync(from: Pane): void {
		scrollDriver = from;
		syncFrame ||= requestAnimationFrame(() => {
			syncFrame = 0;
			syncScroll(scrollDriver);
		});
	}

	// The pane being typed in keeps its place, and the other one catches up with it.
	function leadingPane(): Pane {
		if (outputPaneElement?.contains(document.activeElement)) return 'output';
		if (renderedPaneElement?.contains(document.activeElement)) return 'rendered';
		return scrollDriver;
	}

	function handlePaneScroll(event: Event, pane: Pane): void {
		const scroller = scrollerOf(pane);
		if (event.target !== scroller) return;
		const synced = syncedTops.get(scroller);
		syncedTops.delete(scroller);
		if (synced !== undefined && Math.abs(scroller.scrollTop - synced) <= 1) return;
		queueScrollSync(pane);
	}

	// A pane whose contents were just swapped out follows the other one.
	$effect(() => {
		void outputView;
		tick().then(() => queueScrollSync('rendered'));
	});

	$effect(() => {
		void renderedReadOnly;
		tick().then(() => queueScrollSync('output'));
	});

	$effect(() => {
		void [markdown, renderedMarkdown, bothPanesVisible, stacked, contentWidth];
		tick().then(() => queueScrollSync(leadingPane()));
	});

	$effect(() => {
		void [markdown, renderedMarkdown, renderedReadOnly, contentWidth, markdownLines.length];
		if (renderedReadOnly || !liveEditorContainer) {
			liveLineRects = [];
			return;
		}
		measureLiveLines();
		const frame = requestAnimationFrame(measureLiveLines);
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		if (!liveEditorContainer || renderedReadOnly) return;
		const observer = new ResizeObserver(measureLiveLines);
		observer.observe(liveEditorContainer);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!shell) return;
		const observer = new ResizeObserver(() => queueScrollSync(leadingPane()));
		observer.observe(shell);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(syncFrame);
			syncFrame = 0;
		};
	});
</script>

<svelte:window onkeydown={cancelPaneDrag} />

<main class="workspace">
	<button class="collapsed-sidebar-toggle" aria-label="Show notes sidebar" title={`Show sidebar (${formatShortcut(shortcuts.toggleSidebar, primaryModifier)})`} onclick={onToggleSidebar}><PanelLeft size={19} /></button>
	{#if storageNotice}
		<div class="storage-notice" role="status"><HardDrive size={16} /><span>{storageNotice}</span><button class="storage-dismiss" aria-label="Dismiss storage warning" title="Dismiss" onclick={onDismissStorageNotice}><X size={14} /></button></div>
	{/if}
	{#if storageError}
		<div class="storage-error" role="alert">
			<CloudOff size={16} />
			<span>{storageError} Your current text stays open, but it may be lost when this tab closes. Copy it somewhere safe if the retry keeps failing.</span>
			<button onclick={onRetryStorage}>Try again</button>
			<button onclick={onReload}>Reload</button>
		</div>
	{/if}

	<section bind:this={shell} class="editor-shell" class:output-hidden={!outputPaneVisible} class:rendered-hidden={!renderedPaneVisible} class:panes-stacked={stacked} class:panes-swapped={swapped} class:first-hidden={!firstPaneVisible} class:second-hidden={!secondPaneVisible} class:resizing class:pane-moving={drag?.moving} style={`--split: ${splitRatio}%; --content-width: ${contentWidth}px`}>
		<div bind:this={outputPaneElement} class="output-pane" class:dragged={drag?.moving && drag.pane === 'output'} style={drag?.moving && drag.pane === 'output' ? `translate: ${drag.dx}px ${drag.dy}px; transform-origin: ${drag.originX}px ${drag.originY}px; --lift-scale: ${drag.scale}` : undefined}>
			<div class="output-switcher">
				<div class="output-views" role="tablist" aria-label="Output view">
					{#each outputViews as view (view.id)}
						<button role="tab" class:active={outputView === view.id} aria-selected={outputView === view.id} title={view.description} onclick={() => onOutputViewChange(view.id)}><b class="output-format" aria-hidden="true">{view.format}</b><span>{view.label}</span></button>
					{/each}
				</div>
				<div class="output-actions">
					<button class="output-action" onclick={onCopy} disabled={!hasContent || !activeView.copyTitle} title={activeView.copyTitle ?? 'There is nothing to copy from the PDF view'}><Copy size={14} /><span>Copy</span></button>
					<button class="output-action" onclick={onDownload} disabled={!hasContent} title={activeView.downloadTitle}><Download size={14} /><span>{activeView.downloadLabel}</span></button>
				</div>
			</div>
			<div class="output-body" bind:this={outputBody} onscrollcapture={(event) => handlePaneScroll(event, 'output')} onloadcapture={() => queueScrollSync(leadingPane())}>
				{#if outputView === 'text'}
					<pre class="output-code output-text" aria-label="Plain text">{plainText}</pre>
				{:else if outputView === 'rich-text'}
					<div class="rich-text-preview" aria-label="Rich text">
						{#if hasContent}
							<article class="prose">{@html renderedMarkdown}</article>
						{:else}
							<div class="preview-empty"><PencilLine size={26} /><strong>Nothing to copy yet</strong><span>Write something and it shows up here formatted.</span></div>
						{/if}
					</div>
				{:else if outputView === 'html'}
					<pre class="output-code" aria-label="Generated HTML">{htmlSource}</pre>
				{:else if outputView === 'pdf'}
					<div class="pdf-preview">
						<div class="pdf-sheet paper-surface" aria-label="PDF preview">
							{#if hasContent}
								<article class="prose">{@html renderedMarkdown}</article>
							{:else}
								<div class="preview-empty"><PencilLine size={26} /><strong>Nothing to print yet</strong><span>Write something and this page fills up.</span></div>
							{/if}
						</div>
					</div>
				{:else}
					<textarea bind:this={editor} value={markdown} onfocus={onSourceFocus} onbeforeinput={onEditorBeforeInput} oncopy={onEditorCopy} oncut={onEditorCut} onpaste={onEditorPaste} oninput={(event) => onMarkdownChange(event.currentTarget.value)} aria-label="Markdown editor" placeholder={'# Start with a title\n\nThen write. Onyx saves to this device as you go.'} spellcheck="true" disabled={saveState === 'loading' || transferState === 'working'}></textarea>
				{/if}
			</div>
		</div>
		<div class="pane-divider">
			<button type="button" class="pane-resize" class:enabled={bothPanesVisible} aria-label={`Resize the panes, the ${firstPane} pane takes ${Math.round(splitRatio)} percent`} title="Drag to resize, double-click to even out" tabindex={bothPanesVisible ? 0 : -1} onpointerdown={startResize} onpointermove={trackResize} onpointerup={endResize} onpointercancel={endResize} onkeydown={nudgeResize} ondblclick={resetSplit}></button>
			{#if bothPanesVisible}
				<button type="button" class="pane-grip" class:grip-start={!swapped} aria-label="Move the output pane" title="Drag to move this pane, or use the arrow keys" onpointerdown={(event) => startPaneDrag(event, 'output')} onpointermove={trackPaneDrag} onpointerup={endPaneDrag} onpointercancel={endPaneDrag} onkeydown={(event) => nudgePane(event, 'output')}></button>
				<button type="button" class="pane-grip" class:grip-start={swapped} aria-label="Move the page pane" title="Drag to move this pane, or use the arrow keys" onpointerdown={(event) => startPaneDrag(event, 'rendered')} onpointermove={trackPaneDrag} onpointerup={endPaneDrag} onpointercancel={endPaneDrag} onkeydown={(event) => nudgePane(event, 'rendered')}></button>
			{/if}
			{#if secondPaneVisible}
				{@const label = `${firstPaneVisible ? 'Hide' : 'Show'} the ${firstPane} pane`}
				{@const Icon = firstPaneVisible ? towardsStart : towardsEnd}
				<button class="pane-handle pane-handle-start" title={label} aria-label={label} aria-expanded={firstPaneVisible} onclick={toggleFirstPane}><Icon size={15} /></button>
			{/if}
			{#if firstPaneVisible}
				{@const label = `${secondPaneVisible ? 'Hide' : 'Show'} the ${secondPane} pane`}
				{@const Icon = secondPaneVisible ? towardsEnd : towardsStart}
				<button class="pane-handle pane-handle-end" title={label} aria-label={label} aria-expanded={secondPaneVisible} onclick={toggleSecondPane}><Icon size={15} /></button>
			{/if}
		</div>
		<div bind:this={renderedPaneElement} class="preview-pane" class:dragged={drag?.moving && drag.pane === 'rendered'} style={drag?.moving && drag.pane === 'rendered' ? `translate: ${drag.dx}px ${drag.dy}px; transform-origin: ${drag.originX}px ${drag.originY}px; --lift-scale: ${drag.scale}` : undefined} onscrollcapture={(event) => handlePaneScroll(event, 'rendered')} onloadcapture={() => queueScrollSync(leadingPane())}>
			{#if renderedReadOnly}
				{#if hasContent}
					<article class="prose">{@html renderedMarkdown}</article>
				{:else}
					<div class="preview-empty"><PencilLine size={26} /><strong>Nothing here yet</strong><span>Start writing in the other pane, or unlock this one to begin.</span></div>
				{/if}
			{:else}
				<div class="live-editor prose" bind:this={liveEditorContainer} aria-label="Page editor">
					<div class="live-rendered-content" aria-hidden="true">{@html renderedMarkdown}</div>
					<div class="live-editing-overlay" contenteditable={saveState !== 'loading' && transferState !== 'working'} role="textbox" tabindex="-1" aria-label="Page editor" aria-multiline="true" spellcheck="true" onbeforeinput={onEditorBeforeInput} oncopy={onEditorCopy} oncut={onEditorCut} onpaste={onEditorPaste} oninput={onRenderedInput} onkeydown={onRenderedLineKeydown}>
						{#each markdownLines as line, index}
							<div class="live-editable-line {liveLineKind(line, index)}" class:active={index === liveLine} style={liveLineStyle(index)} role="textbox" tabindex="0" aria-label={`Markdown line ${index + 1}`} aria-multiline="false" data-live-line={index} data-code-language={liveCodeLanguage(index) || undefined} onfocus={() => onLiveLineFocus(index)}>{@html renderEditableLine(line, index)}</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		{#if dropSlot}
			<div class="pane-drop-slot" style={dropSlot} aria-hidden="true"></div>
		{/if}
	</section>
</main>
