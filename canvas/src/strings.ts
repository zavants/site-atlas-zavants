/** Every string the canvas shows. Text taken from scanned sites comes from the map data, never from here. */
export const t = {
  conflict: 'The map changed while you were editing; it was reloaded.',
  historyReset: 'The map changed elsewhere; history was reset.',
  resetConfirm: 'Are you sure you want to undo all changes?',
  errorStatus: (status: number) => `Error ${status}`,

  home: {
    empty: 'No scanned sites yet. Run ',
    emptyOr: ' or use the MCP tool ',
    loading: 'Loading…',
  },
  head: {
    scan: 'scan',
    errors: 'errors',
    warnings: 'warnings',
    info: 'info',
    view: 'View',
    real: 'Real',
    planned: 'Planned',
    addPage: '+ Planned page',
    rescan: 'Rescan',
    switchHint: 'Switch to Planned to reorganize.',
    pathPrompt: 'Path of the planned page (for example /solutions)',
    titlePrompt: 'Page title',
    scanning: 'Scan in progress…',
    scanDone: 'Scan finished.',
  },
  globals: { label: 'Global', aria: 'Global blocks' },
  orphans: {
    title: 'Orphans',
    hint: 'Organized blocks that no longer appear on the site.',
    assignTo: (name: string) => `Assign to ${name}`,
    discard: 'Discard',
  },
  trash: 'Drop here to mark as deleted',

  kind: { narrative: 'narrative', visual: 'visual', conversion: 'conversion' },

  card: {
    new: 'new',
    moved: 'moved',
    editTags: 'Edit tags',
    done: 'done',
    restore: 'Restore',
    tags: 'Tags',
    createTagHint: 'Create a tag in the top bar.',
  },

  panel: {
    aria: 'Block details',
    close: 'Close',
    page: 'page',
    type: 'Type',
    auto: 'Automatic',
    issues: 'Issues',
    headings: 'Headings',
    links: 'Links',
    forms: 'Forms',
    fields: 'fields',
    noAction: '(no action)',
    media: 'Media',
    text: 'Text',
  },

  column: { planned: 'planned', dropHere: 'Drag blocks here', noBlocks: 'No blocks' },

  tags: {
    aria: 'Tags',
    filter: 'Filter by tag:',
    name: 'Tag name',
    newName: 'New name',
    confirmDelete: (name: string) => `Delete the tag "${name}"? It will be removed from all blocks.`,
    dblclick: 'Double-click to rename',
    delete: (name: string) => `Delete ${name}`,
    add: '+ Tag',
  },
};
