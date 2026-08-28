export class SessionCsvLog {
  private rows: Record<string, string | number | boolean>[] = [];
  readonly limit: number;
  constructor(limit = 50_000) {
    this.limit = limit;
  }
  add(row: Record<string, unknown>) {
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(row))
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        clean[key] = value;
    clean.logged_at = new Date().toISOString();
    this.rows.push(clean);
    if (this.rows.length > this.limit) this.rows.shift();
  }
  get size() {
    return this.rows.length;
  }
  reset() {
    this.rows = [];
  }
  csv(): string {
    const keys = Array.from(
      new Set(this.rows.flatMap((row) => Object.keys(row))),
    );
    const quote = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return [
      keys.map(quote).join(","),
      ...this.rows.map((row) => keys.map((key) => quote(row[key])).join(",")),
    ].join("\n");
  }
  download(filename: string) {
    const blob = new Blob([this.csv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
