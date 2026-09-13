<script lang="ts">
	import { tick } from 'svelte';
	import { Copy, Download, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CloudOff, Grip, HardDrive, PanelLeft, PencilLine, X } from '@lucide/svelte';
	import { formatShortcut, type KeyboardShortcuts, type PrimaryModifier } from '$lib';
	import type { InlinePreviewBehavior } from './settings-dialog.svelte';
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
		htmlSource: string;
		renderedReadOnly: boolean;
		inlinePreviewBehavior: InlinePreviewBehavior;
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
		liveEditor?: HTMLTextAreaElement;
		liveEditorContainer?: HTMLDivElement;
		onRetryStorage: () => void;
		onDismissStorageNotice: () => void;
		onToggleSidebar: () => void;
		splitRatio: number;
		contentWidth: number;
		onToggleOutputPane: () => void;
		onOutputViewChange: (view: OutputView) => void;
		onCopyText: () => void;
		onDownloadText: () => void;
		onCopyRichText: () => void;
		onDownloadRtf: () => void;
		onDownloadHtml: () => void;
		onSavePdf: () => void;
		onToggleRenderedPane: () => void;
		onResize: (ratio: number) => void;
		onResizeEnd: () => void;
		onPlacePane: (pane: 'output' | 'rendered', edge: PaneEdge) => void;
		onReload: () => void;
		onMarkdownChange: (value: string) => void;
		onSourceFocus: () => void;
		onLiveLineFocus: (line: number) => void;
		onRenderedLineInput: (line: number, element: HTMLElement) => void;
		onRenderedLineKeydown: (event: KeyboardEvent, line: number) => void;
		onLiveLineChange: (line: number, value: string) => void;
		onLiveLineKeydown: (event: KeyboardEvent, line: number) => void;
		onActivateLiveLine: (line: number) => void;
		renderEditableLine: (line: string, index: number) => string;
		renderLiveLine: (line: string, index: number) => string;
		liveLineKind: (line: string, index: number) => string;
	}

	let {
		storageNotice, storageError, outputPaneVisible, renderedPaneVisible, paneLayout, paneOrder, outputView, plainText, htmlSource, renderedReadOnly, inlinePreviewBehavior, markdown, markdownLines, liveLine,
		saveState, transferState, hasContent, renderedMarkdown, shortcuts, primaryModifier,
		editor = $bindable(), liveEditor = $bindable(), liveEditorContainer = $bindable(), onRetryStorage, onDismissStorageNotice, onToggleSidebar,
		splitRatio, contentWidth, onToggleOutputPane, onOutputViewChange, onCopyText, onDownloadText, onCopyRichText, onDownloadRtf, onDownloadHtml, onSavePdf, onToggleRenderedPane, onResize, onResizeEnd, onPlacePane, onReload, onMarkdownChange, onSourceFocus, onLiveLineFocus, onRenderedLineInput,
		onRenderedLineKeydown, onLiveLineChange, onLiveLineKeydown, onActivateLiveLine,
		renderEditableLine, renderLiveLine, liveLineKind
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

	// Grips sit in the corner facing the divider, beside the pane handles; stacked panes keep them on the right.
	function gripAtStart(pane: Pane): boolean {
		return paneEdge(pane) === 'right';
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
		// Only the bare toolbar and grip start a move, so the tabs and actions keep their clicks.
		if ((event.target as HTMLElement).closest('button:not(.pane-grip)')) return;
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
			<div class="output-toolbar" class:draggable={bothPanesVisible} role="presentation" onpointerdown={(event) => startPaneDrag(event, 'output')} onpointermove={trackPaneDrag} onpointerup={endPaneDrag} onpointercancel={endPaneDrag}>
				<button type="button" class="pane-grip" class:grip-start={gripAtStart('output')} hidden={!bothPanesVisible} aria-label="Move the output pane" title="Drag to move this pane, or use the arrow keys" onkeydown={(event) => nudgePane(event, 'output')}><Grip size={14} /></button>
				<div class="output-views" role="tablist" aria-label="Output view">
					{#each outputViews as view (view.id)}
						<button role="tab" class:active={outputView === view.id} aria-selected={outputView === view.id} title={view.description} onclick={() => onOutputViewChange(view.id)}><view.icon size={14} /><span>{view.label}</span></button>
					{/each}
				</div>
				{#if outputView === 'text'}
					<div class="output-actions">
						<button class="output-action" onclick={onCopyText} disabled={!hasContent} title="Copy this note as plain text"><Copy size={14} /><span>Copy</span></button>
						<button class="output-action" onclick={onDownloadText} disabled={!hasContent} title="Download this note as a text file"><Download size={14} /><span>Download</span></button>
					</div>
				{:else if outputView === 'rich-text'}
					<div class="output-actions">
						<button class="output-action" onclick={onCopyRichText} disabled={!hasContent} title="Copy this note with its formatting, to paste into a document or email"><Copy size={14} /><span>Copy</span></button>
						<button class="output-action" onclick={onDownloadRtf} disabled={!hasContent} title="Download this note as an RTF document"><Download size={14} /><span>Download</span></button>
					</div>
				{:else if outputView === 'html'}
					<button class="output-action" onclick={onDownloadHtml} disabled={!hasContent} title="Download this note as an HTML file"><Download size={14} /><span>Download</span></button>
				{:else if outputView === 'pdf'}
					<button class="output-action" onclick={onSavePdf} disabled={!hasContent} title="Print this note, or save it as a PDF from the print dialog"><Download size={14} /><span>Save as PDF</span></button>
				{/if}
			</div>
			<div class="output-body">
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
					<textarea bind:this={editor} value={markdown} onfocus={onSourceFocus} oninput={(event) => onMarkdownChange(event.currentTarget.value)} aria-label="Markdown editor" placeholder={'# Start with a title\n\nThen write. Onyx saves to this device as you go.'} spellcheck="true" disabled={saveState === 'loading' || transferState === 'working'}></textarea>
				{/if}
			</div>
		</div>
		<div class="pane-divider">
			<button type="button" class="pane-resize" class:enabled={bothPanesVisible} aria-label={`Resize the panes, the ${firstPane} pane takes ${Math.round(splitRatio)} percent`} title="Drag to resize, double-click to even out" tabindex={bothPanesVisible ? 0 : -1} onpointerdown={startResize} onpointermove={trackResize} onpointerup={endResize} onpointercancel={endResize} onkeydown={nudgeResize} ondblclick={resetSplit}></button>
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
		<div bind:this={renderedPaneElement} class="preview-pane" class:dragged={drag?.moving && drag.pane === 'rendered'} style={drag?.moving && drag.pane === 'rendered' ? `translate: ${drag.dx}px ${drag.dy}px; transform-origin: ${drag.originX}px ${drag.originY}px; --lift-scale: ${drag.scale}` : undefined}>
			<div class="pane-grip-anchor">
				<button type="button" class="pane-grip" class:grip-start={gripAtStart('rendered')} hidden={!bothPanesVisible} aria-label="Move the page pane" title="Drag to move this pane, or use the arrow keys" onpointerdown={(event) => startPaneDrag(event, 'rendered')} onpointermove={trackPaneDrag} onpointerup={endPaneDrag} onpointercancel={endPaneDrag} onkeydown={(event) => nudgePane(event, 'rendered')}><Grip size={14} /></button>
			</div>
			{#if renderedReadOnly}
				{#if hasContent}
					<article class="prose">{@html renderedMarkdown}</article>
				{:else}
					<div class="preview-empty"><PencilLine size={26} /><strong>Nothing here yet</strong><span>Start writing in the other pane, or unlock this one to begin.</span></div>
				{/if}
			{:else}
				<div class="live-editor" bind:this={liveEditorContainer} aria-label="Page editor">
					{#each markdownLines as line, index}
						{#if inlinePreviewBehavior === 'rendered'}
							<div class="live-editable-line {liveLineKind(line, index)}" class:active={index === liveLine} contenteditable={saveState !== 'loading' && transferState !== 'working'} role="textbox" tabindex="0" aria-label={`Markdown line ${index + 1}`} aria-multiline="false" data-live-line={index} spellcheck="true" onfocus={() => onLiveLineFocus(index)} oninput={(event) => onRenderedLineInput(index, event.currentTarget)} onkeydown={(event) => onRenderedLineKeydown(event, index)}>{@html renderEditableLine(line, index)}</div>
						{:else if index === liveLine}
							<textarea class="live-source-line" bind:this={liveEditor} value={line} oninput={(event) => onLiveLineChange(index, event.currentTarget.value)} onkeydown={(event) => onLiveLineKeydown(event, index)} aria-label={`Markdown line ${index + 1}`} rows="1" spellcheck="true" disabled={saveState === 'loading' || transferState === 'working'}></textarea>
						{:else}
							<div class="live-rendered-line" class:blank={!line} role="button" tabindex="0" aria-label={`Edit line ${index + 1}`} onclick={() => onActivateLiveLine(index)} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivateLiveLine(index); } }}>{@html renderLiveLine(line, index)}</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
		{#if dropSlot}
			<div class="pane-drop-slot" style={dropSlot} aria-hidden="true"></div>
		{/if}
	</section>
</main>
