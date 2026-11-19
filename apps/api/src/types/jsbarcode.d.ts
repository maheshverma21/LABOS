declare module "jsbarcode" {
  interface Encoding {
    text: string;
    /** "1" for a bar and "0" for a space, one character per module. */
    data: string;
  }
  function JsBarcode(target: object, text: string, options?: Record<string, unknown>): void;
  export default JsBarcode;
}
