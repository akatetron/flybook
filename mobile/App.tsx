import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LibraryScreen } from "./src/LibraryScreen";
import { ReaderScreen } from "./src/ReaderScreen";
import { colors } from "./src/theme";

export default function App() {
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        {open ? <ReaderScreen key={open} bookId={open} onBack={() => setOpen(null)} /> : <LibraryScreen onOpen={setOpen} />}
      </SafeAreaView>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
