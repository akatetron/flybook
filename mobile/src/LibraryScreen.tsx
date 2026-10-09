import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { buildBookText } from "../../shared/text";
import { sampleBook } from "../../shared/sample";
import Native from "../modules/flybook-native";
import { addBook, audioBytes, deleteBook, listBooks, type BookMeta } from "./storage";
import { WORDS_PER_MINUTE, colors, formatBytes, formatMinutes } from "./theme";

export function LibraryScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [books, setBooks] = useState<BookMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listBooks()
      .then(setBooks)
      .catch(() => setBooks([]));
  }, []);
  useEffect(refresh, [refresh]);

  async function addPdf() {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    setBusy(`Reading ${file.name}…`);
    try {
      const pdf = await Native.extractPdf(file.uri);
      const text = buildBookText(pdf.pages, pdf.outline);
      if (text.segments.length === 0) {
        throw new Error("No readable text in this PDF. Scanned pages need text recognition, which is coming in a later update.");
      }
      const id = await addBook(pdf.title ?? file.name.replace(/\.pdf$/i, ""), file.name, text);
      onOpen(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addSample() {
    const book = sampleBook();
    onOpen(await addBook(book.title, "sample", book));
  }

  function remove(book: BookMeta) {
    Alert.alert(`Remove “${book.title}”?`, `This deletes the book and its ${formatBytes(audioBytes(book.id))} of audio from this phone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await deleteBook(book.id);
          refresh();
        },
      },
    ]);
  }

  const empty = books !== null && books.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.brand}>FlyBook</Text>
        {!empty && (
          <Pressable style={styles.add} onPress={addPdf} disabled={!!busy} accessibilityLabel="Add a PDF">
            <Text style={styles.addText}>+ Add PDF</Text>
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.muted}>{busy}</Text>
        </View>
      )}

      {empty && !busy && (
        <View style={styles.welcome}>
          <Text style={styles.hero}>
            Turn any PDF into an <Text style={{ color: colors.gold }}>audiobook</Text>.
          </Text>
          <Text style={styles.muted}>Read aloud by your phone's own voices. Nothing is uploaded and there's no account.</Text>
          <Pressable style={styles.primary} onPress={addPdf}>
            <Text style={styles.primaryText}>Choose a PDF</Text>
          </Pressable>
          <Pressable onPress={addSample}>
            <Text style={styles.link}>or try a short sample story</Text>
          </Pressable>
        </View>
      )}

      {books && books.length > 0 && (
        <FlatList
          data={books}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const progress = item.segmentCount > 1 ? item.position / (item.segmentCount - 1) : 0;
            const left = (item.words * (1 - progress)) / WORDS_PER_MINUTE;
            return (
              <Pressable style={styles.book} onPress={() => onOpen(item.id)} onLongPress={() => remove(item)}>
                <View style={styles.cover}>
                  <Text style={styles.coverLetter}>{item.title.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.bookTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.muted}>
                    {progress > 0.995 ? "Finished" : progress > 0 ? `${Math.round(progress * 100)}% · ${formatMinutes(left)} left` : formatMinutes(left)}
                  </Text>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                </View>
                <Pressable onPress={() => remove(item)} hitSlop={12} accessibilityLabel={`Remove ${item.title}`}>
                  <Text style={styles.more}>⋯</Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 },
  brand: { color: colors.text, fontSize: 26, fontWeight: "700" },
  add: { backgroundColor: colors.gold, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  addText: { color: colors.onGold, fontWeight: "700" },
  error: { color: colors.danger, marginBottom: 12, fontSize: 15 },
  busy: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 12 },
  welcome: { flex: 1, justifyContent: "center", gap: 16, paddingBottom: 80 },
  hero: { color: colors.text, fontSize: 34, fontWeight: "700", lineHeight: 40 },
  muted: { color: colors.muted, fontSize: 14 },
  primary: { backgroundColor: colors.gold, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  primaryText: { color: colors.onGold, fontSize: 17, fontWeight: "700" },
  link: { color: colors.gold, textAlign: "center", fontSize: 15 },
  book: { flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: colors.surface, borderRadius: 14, padding: 12 },
  cover: { width: 52, height: 68, borderRadius: 8, backgroundColor: colors.surfaceHigh, alignItems: "center", justifyContent: "center" },
  coverLetter: { color: colors.gold, fontSize: 24, fontWeight: "700" },
  bookTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  bar: { height: 3, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 3, backgroundColor: colors.gold },
  more: { color: colors.muted, fontSize: 22, paddingHorizontal: 4 },
});
