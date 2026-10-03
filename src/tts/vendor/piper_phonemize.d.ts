export interface PiperPhonemizeModule {
  callMain(args: string[]): number;
}
export function createPiperPhonemize(options: {
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  locateFile?: (path: string) => string;
  noExitRuntime?: boolean;
}): Promise<PiperPhonemizeModule>;
