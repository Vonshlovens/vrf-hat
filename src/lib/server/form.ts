/** A text field from a form submission; '' if missing or not text (e.g. a file). */
export function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
