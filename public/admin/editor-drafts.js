// A full load/save/discard starts a new editing session. Local redraws keep their drafts.
export function resetDraftEditors(form) {
  for (const target of form.querySelectorAll(
    '#feeds-editor,#widgets-editor,#connections-editor,#phone-editor',
  ))
    target.replaceChildren();
}
