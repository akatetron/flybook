import { NativeModule, requireNativeModule } from "expo";
import type { PdfText, RenderResult, SystemVoice } from "./FlybookNative.types";

declare class FlybookNativeModule extends NativeModule<{}> {
  /** On-device voices only; voices that need the network are left out. */
  getVoices(): Promise<SystemVoice[]>;
  /**
   * Speaks `text` with a system voice into an audio file at `path`
   * (a file:// URI or plain path; iOS writes .caf, Android writes .wav).
   * `rate` is 1 for normal speed.
   */
  renderToFile(text: string, voiceId: string, rate: number, path: string): Promise<RenderResult>;
  /** Positioned text lines for each page, read on the device. */
  extractPdf(uri: string): Promise<PdfText>;
}

export default requireNativeModule<FlybookNativeModule>("FlybookNative");
