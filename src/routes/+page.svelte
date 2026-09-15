<script lang="ts">
	import CommandPalette from '$lib/components/command-palette.svelte';
	import MarkdownWorkspace from '$lib/components/markdown-workspace.svelte';
	import NotesSidebar from '$lib/components/notes-sidebar.svelte';
	import RestoreDialog from '$lib/components/restore-dialog.svelte';
	import SettingsDialog from '$lib/components/settings-dialog.svelte';
	import StatusNotices from '$lib/components/status-notices.svelte';
	import { createPageController } from './page-controller.svelte.js';

	const page = createPageController();
</script>

<svelte:head>
	<title>onyx - a quiet place to think in markdown</title>
	<meta name="description" content="A fast, local-first Markdown editor with full-text search that works offline." />
</svelte:head>

<div class="app" class:sidebar-open={page.sidebarOpen} class:sidebar-collapsed={page.sidebarCollapsed} inert={page.paletteOpen || page.settingsOpen || page.restoreModalOpen}>
	<NotesSidebar
		vaults={page.vaults}
		activeVaultId={page.activeVaultId}
		activeNoteId={page.activeNoteId}
		results={page.results}
		visibleResults={page.visibleResults}
		searchQuery={page.searchQuery}
		notePage={page.notePage}
		notePageCount={page.notePageCount}
		saveState={page.saveState}
		notesLoaded={page.notesLoaded}
		transferState={page.transferState}
		storageError={page.storageError}
		paletteOpen={page.paletteOpen}
		settingsOpen={page.settingsOpen}
		isOnline={page.isOnline}
		githubState={page.githubState}
		githubUser={page.githubUser}
		githubMessage={page.githubMessage}
		shortcuts={page.shortcuts}
		primaryModifier={page.primaryModifier}
		renderedPaneVisible={page.renderedPaneVisible}
		renderedReadOnly={page.renderedReadOnly}
		wordCount={page.wordCount}
		readingMinutes={page.readingMinutes}
		contentWidth={page.contentWidth}
		bind:searchInput={page.searchInput}
		bind:noteList={page.noteList}
		onToggleSidebar={page.toggleSidebar}
		onSelectVault={(id) => void page.selectVault(id)}
		onCreateVault={() => void page.createVault()}
		onRenameVault={page.renameVault}
		onCreateNote={() => void page.createNote()}
		onSearch={page.queueSearch}
		onOpenPalette={() => void page.openPalette()}
		onOpenSettings={() => page.openSettings('storage')}
		onDisconnectGithub={() => void page.disconnectGitHub()}
		onMoveNoteFocus={page.moveNoteFocus}
		onSelectNote={(id) => void page.selectNote(id)}
		onChangePage={page.changeNotePage}
		onInsertSyntax={(before, after, placeholder) => void page.insertSyntax(before, after, placeholder)}
		onPrefixLine={(prefix) => void page.prefixLine(prefix)}
		onToggleRenderedReadOnly={page.toggleRenderedReadOnly}
		onContentWidthChange={page.setContentWidth}
	/>

	<MarkdownWorkspace
		storageNotice={page.storageNotice}
		storageError={page.storageError}
		outputPaneVisible={page.outputPaneVisible}
		renderedPaneVisible={page.renderedPaneVisible}
		paneLayout={page.paneLayout}
		paneOrder={page.paneOrder}
		outputView={page.outputView}
		plainText={page.plainText}
		plainTextBlocks={page.plainTextBlocks}
		htmlSource={page.htmlSource}
		htmlSourceBlocks={page.htmlSourceBlocks}
		renderedBlockLines={page.renderedBlockLines}
		renderedReadOnly={page.renderedReadOnly}
		markdown={page.markdown}
		markdownLines={page.markdownLines}
		liveLine={page.liveLine}
		saveState={page.saveState}
		transferState={page.transferState}
		hasContent={page.hasContent}
		renderedMarkdown={page.renderedMarkdown}
		shortcuts={page.shortcuts}
		primaryModifier={page.primaryModifier}
		bind:editor={page.editor}
		bind:liveEditorContainer={page.liveEditorContainer}
		onRetryStorage={() => void (page.vault ? page.saveDraft() : page.openVault())}
		onDismissStorageNotice={page.dismissStorageNotice}
		onToggleSidebar={page.toggleSidebar}
		splitRatio={page.splitRatio}
		contentWidth={page.contentWidth}
		onToggleOutputPane={page.toggleOutputPane}
		onOutputViewChange={page.setOutputView}
		onCopy={() => void page.copyOutput()}
		onDownload={page.downloadOutput}
		onToggleRenderedPane={page.toggleRenderedPane}
		onResize={page.setSplitRatio}
		onResizeEnd={page.saveSplitRatio}
		onPlacePane={page.placePane}
		onReload={() => location.reload()}
		onMarkdownChange={page.updateMarkdown}
		onSourceFocus={page.focusSourceEditor}
		onLiveLineFocus={page.focusLiveLine}
		onRenderedLineInput={page.updateRenderedLine}
		onRenderedLineKeydown={page.handleRenderedLineKeydown}
		renderEditableLine={page.renderEditableLine}
		liveLineKind={page.liveLineKind}
		liveCodeLanguage={page.liveCodeLanguage}
	/>
</div>

<div class="print-document paper-surface" aria-hidden="true"><article class="prose">{@html page.renderedMarkdown}</article></div>

<StatusNotices
	backupMessage={page.backupMessage}
	backupState={page.backupState}
	backupCommitUrl={page.backupCommitUrl}
	transferMessage={page.transferMessage}
	transferState={page.transferState}
	onDismissBackup={page.dismissBackupMessage}
	onDismissTransfer={page.dismissTransferMessage}
/>

{#if page.paletteOpen}
	<CommandPalette items={page.paletteItems} onClose={() => (page.paletteOpen = false)} />
{/if}

{#if page.settingsOpen}
	<SettingsDialog
		vault={page.vault}
		vaultName={page.vaultName}
		suggestedRepositoryName={page.suggestedRepositoryName}
		isOnline={page.isOnline}
		githubUser={page.githubUser}
		githubState={page.githubState}
		githubMessage={page.githubMessage}
		githubBackup={page.githubBackup}
		pendingBackupCount={page.pendingBackupCount}
		backupState={page.backupState}
		backupMessage={page.backupMessage}
		backupCommitUrl={page.backupCommitUrl}
		transferState={page.transferState}
		theme={page.theme}
		resolvedTheme={page.resolvedTheme}
		colorTheme={page.colorTheme}
		fonts={page.fonts}
		shortcuts={page.shortcuts}
		primaryModifier={page.primaryModifier}
		onThemeChange={page.setTheme}
		onColorThemeChange={page.setColorTheme}
		onFontChange={page.setFont}
		onResetFonts={page.resetFonts}
		onShortcutChange={page.setShortcut}
		onResetShortcuts={page.resetShortcuts}
		bind:section={page.settingsSection}
		onClose={() => (page.settingsOpen = false)}
		onConnectGithub={() => void page.connectGitHub()}
		onDisconnectGithub={() => void page.disconnectGitHub()}
		onCreateRepository={(name) => void page.createBackupRepository(name)}
		onSelectRepository={(state) => void page.selectBackupRepository(state)}
		onForgetRepository={() => void page.forgetBackupRepository()}
		onBackup={() => void page.beginBackup()}
		onRestore={() => { page.settingsOpen = false; void page.openRestore(); }}
		onImportFolder={() => page.folderInput?.click()}
		onImportZip={() => page.zipInput?.click()}
		onExportFolder={() => void page.exportFolder()}
		onExportZip={() => void page.exportZip()}
		onPrepareVaultDeletion={page.prepareVaultDeletion}
		onDeleteVault={page.clearVault}
	/>
{/if}

<input class="transfer-input" bind:this={page.folderInput} type="file" webkitdirectory multiple onchange={(event) => void page.importFolder(event.currentTarget.files)} />
<input class="transfer-input" bind:this={page.zipInput} type="file" accept=".zip,application/zip" onchange={(event) => void page.importZip(event.currentTarget.files)} />

{#if page.restoreModalOpen}
	<RestoreDialog
		isOnline={page.isOnline}
		restoreState={page.restoreState}
		restoreMessage={page.restoreMessage}
		restoreCommits={page.restoreCommits}
		pendingBackupCount={page.pendingBackupCount}
		bind:selectedRestoreSha={page.selectedRestoreSha}
		bind:restoreOwner={page.restoreOwner}
		bind:restoreRepository={page.restoreRepository}
		bind:restoreBranch={page.restoreBranch}
		bind:restoreDirectory={page.restoreDirectory}
		onClose={() => (page.restoreModalOpen = false)}
		onLoadCommits={() => void page.loadRestoreCommits()}
		onRestore={() => void page.restoreSelectedCommit()}
		formatCommitDate={page.formatCommitDate}
	/>
{/if}
