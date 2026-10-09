import { StatusBar } from "expo-status-bar";
import { useAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { Paths } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Native, { type SystemVoice } from "./modules/flybook-native";
import { sampleBook } from "../shared/sample";
import { buildBookText, speakable, type BookText } from "../shared/text";

// Engine check screen: exercises the native voice and PDF code on a real
// phone before the library and player are built on top of it.
export default function App() {
  const sample = useMemo(() => sampleBook(), []);
  const [book, setBook] = useState<BookText & { title: string }>(sample);
  const [voices, setVoices] = useState<SystemVoice[]>([]);
  const [voice, setVoice] = useState<SystemVoice | null>(null);
  const [status, setStatus] = useState("Loading voices…");
  const player = useAudioPlayer();

  useEffect(() => {
    Native.getVoices()
      .then((all) => {
        const english = all
          .filter((v) => v.language.startsWith("en"))
          .sort((a, b) => Number(b.enhanced) - Number(a.enhanced) || a.name.localeCompare(b.name));
        setVoices(english);
        setVoice(english[0] ?? null);
        setStatus(`${all.length} on-device voices, ${english.length} English`);
      })
      .catch((e: Error) => setStatus(`Voices failed: ${e.message}`));
  }, []);

  async function speakFirst() {
    if (!voice) return;
    const first = book.segments.find((s) => !s.h) ?? book.segments[0];
    const ext = process.env.EXPO_OS === "ios" ? "caf" : "wav";
    const path = `${Paths.cache.uri}/check-${Date.now()}.${ext}`;
    setStatus("Rendering…");
    const started = Date.now();
    try {
      const { durationMs } = await Native.renderToFile(speakable(first), voice.id, 1, path);
      const took = Date.now() - started;
      setStatus(`Rendered ${(durationMs / 1000).toFixed(1)}s of audio in ${(took / 1000).toFixed(1)}s`);
      player.replace({ uri: path });
      player.play();
    } catch (e) {
      setStatus(`Render failed: ${(e as Error).message}`);
    }
  }

  async function pickPdf() {
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    setStatus(`Reading ${file.name}…`);
    const started = Date.now();
    try {
      const pdf = await Native.extractPdf(file.uri);
      const text = buildBookText(pdf.pages, pdf.outline);
      setBook({ ...text, title: pdf.title ?? file.name.replace(/\.pdf$/i, "") });
      setStatus(`Read ${pdf.pageCount} pages in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (e) {
      setStatus(`PDF failed: ${(e as Error).message}`);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.brand}>FlyBook · engine check</Text>
        <Text style={styles.title}>{book.title}</Text>
        <Text style={styles.muted}>
          {book.chapters.length} chapters · {book.segments.length} sentences · {book.words} words
        </Text>
        <Text style={styles.status}>{status}</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={speakFirst} disabled={!voice}>
            <Text style={styles.buttonText}>Speak first sentence</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={pickPdf}>
            <Text style={styles.secondaryText}>Open a PDF</Text>
          </Pressable>
        </View>
        <Text style={styles.section}>Voice</Text>
        {voices.map((v) => (
          <Pressable key={v.id} onPress={() => setVoice(v)} style={[styles.voice, voice?.id === v.id && styles.voiceOn]}>
            <Text style={styles.voiceText}>
              {v.name} <Text style={styles.muted}>{v.language}{v.enhanced ? " · enhanced" : ""}</Text>
            </Text>
          </Pressable>
        ))}
        <Text style={styles.section}>Chapters</Text>
        {book.chapters.map((c) => (
          <Text key={c.start} style={styles.chapter}>
            {c.title}
          </Text>
        ))}
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1510" },
  body: { padding: 24, paddingTop: 72, gap: 8 },
  brand: { color: "#e9c770", fontSize: 14, fontWeight: "600", letterSpacing: 1 },
  title: { color: "#efeadc", fontSize: 28, fontWeight: "600" },
  muted: { color: "#9fb3a8", fontSize: 14 },
  status: { color: "#e9c770", fontSize: 15, marginVertical: 8 },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  button: { backgroundColor: "#e9c770", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  buttonText: { color: "#0b1510", fontWeight: "600", fontSize: 15 },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#e9c770" },
  secondaryText: { color: "#e9c770", fontWeight: "600", fontSize: 15 },
  section: { color: "#9fb3a8", fontSize: 13, marginTop: 20, textTransform: "uppercase", letterSpacing: 1 },
  voice: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  voiceOn: { backgroundColor: "#16302a" },
  voiceText: { color: "#efeadc", fontSize: 16 },
  chapter: { color: "#efeadc", fontSize: 17, paddingVertical: 6 },
});
