import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SystemVoice } from "../modules/flybook-native";
import { player, type PlayerState } from "./player";
import { preparer, type PrepStatus } from "./preparer";
import { getBook, loadContent, updateBook, type BookContent, type BookMeta } from "./storage";
import { colors, formatMinutes } from "./theme";
import { defaultVoice, getVoices, languageName } from "./voices";

const RATES = [0.8, 1, 1.25, 1.5, 2];
const SLEEP = [15, 30, 60];

function usePlayer(): PlayerState {
  const [s, set] = useState(player.state);
  useEffect(() => player.subscribe(set), []);
  return s;
}

function usePrep(): PrepStatus {
  const [s, set] = useState<PrepStatus>({ bookId: null, state: "idle", ready: 0, total: 0 });
  useEffect(() => preparer.subscribe(set), []);
  return s;
}

export function ReaderScreen({ bookId, onBack }: { bookId: string; onBack: () => void }) {
  const [book, setBook] = useState<BookMeta | null>(null);
  const [content, setContent] = useState<BookContent | null>(null);
  const [voice, setVoice] = useState<SystemVoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"voice" | "chapters" | null>(null);
  const p = usePlayer();
  const prep = usePrep();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [meta, text, voices] = await Promise.all([getBook(bookId), loadContent(bookId), getVoices()]);
        if (!meta || !live) return;
        const chosen = voices.find((v) => v.id === meta.voiceId) ?? (await defaultVoice());
        if (!chosen) throw new Error("This phone has no text-to-speech voices installed.");
        if (chosen.id !== meta.voiceId) await updateBook(bookId, { voiceId: chosen.id });
        await updateBook(bookId, { openedAt: Date.now() });
        setBook(meta);
        setContent(text);
        setVoice(chosen);
        player.open(meta, text.segments, text.chapters, chosen.id);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [bookId]);

  const chapters = content?.chapters ?? [];
  const chapterIndex = useMemo(() => {
    let found = 0;
    chapters.forEach((c, i) => c.start <= p.index && (found = i));
    return found;
  }, [chapters, p.index]);

  if (error) {
    return (
      <View style={styles.root}>
        <Back onBack={onBack} />
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!book || !content || !voice) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const segments = content.segments;
  const current = segments[p.index];
  const chapter = chapters[chapterIndex];
  const chapterEnd = chapters[chapterIndex + 1]?.start ?? segments.length;
  const chapterReady = chapter ? preparer.readyIn(bookId, chapter.start, chapterEnd) : 0;
  const chapterTotal = chapter ? chapterEnd - chapter.start : segments.length;
  const prepLine =
    prep.state === "no-space"
      ? prep.message
      : prep.state === "error"
        ? prep.message
        : prep.state === "done"
          ? "Whole book ready · plays offline"
          : `Preparing · ${prep.ready} of ${prep.total} sentences ready`;

  return (
    <View style={styles.root}>
      <Back onBack={onBack} />
      <Text style={styles.title} numberOfLines={2}>
        {book.title}
      </Text>
      <Pressable onPress={() => setSheet("chapters")}>
        <Text style={styles.chapter} numberOfLines={1}>
          {chapter?.title ?? "Start"} ▾
        </Text>
      </Pressable>

      <ScrollView style={styles.textBox} contentContainerStyle={{ paddingVertical: 12 }}>
        <Text style={styles.prev}>{segments[p.index - 1]?.t ?? ""}</Text>
        <Text style={styles.now}>{current?.t}</Text>
        <Text style={styles.next}>{segments[p.index + 1]?.t ?? ""}</Text>
      </ScrollView>

      <View style={styles.progressRow}>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round((p.index / Math.max(1, segments.length - 1)) * 100)}%` }]} />
        </View>
        <Text style={styles.small}>
          {p.waiting ? "Preparing the next sentence…" : `Chapter: ${chapterReady} of ${chapterTotal} ready`}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => player.seek(chapter && p.index > chapter.start ? chapter.start : (chapters[chapterIndex - 1]?.start ?? 0))} hitSlop={10} accessibilityLabel="Previous chapter">
          <Text style={styles.ctl}>⏮</Text>
        </Pressable>
        <Pressable onPress={() => player.seek(p.index - 1)} hitSlop={10} accessibilityLabel="Previous sentence">
          <Text style={styles.ctl}>↺</Text>
        </Pressable>
        <Pressable style={styles.play} onPress={() => player.toggle()} accessibilityLabel={p.playing ? "Pause" : "Play"}>
          {p.waiting ? <ActivityIndicator color={colors.onGold} /> : <Text style={styles.playText}>{p.playing ? "❚❚" : "▶"}</Text>}
        </Pressable>
        <Pressable onPress={() => player.seek(p.index + 1)} hitSlop={10} accessibilityLabel="Next sentence">
          <Text style={styles.ctl}>↻</Text>
        </Pressable>
        <Pressable onPress={() => chapters[chapterIndex + 1] && player.seek(chapters[chapterIndex + 1].start)} hitSlop={10} accessibilityLabel="Next chapter">
          <Text style={styles.ctl}>⏭</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {RATES.map((r) => (
          <Pressable key={r} style={[styles.chip, p.rate === r && styles.chipOn]} onPress={() => player.setRate(r)}>
            <Text style={[styles.chipText, p.rate === r && styles.chipTextOn]}>{r}×</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chips}>
        <Pressable style={styles.chip} onPress={() => setSheet("voice")}>
          <Text style={styles.chipText} numberOfLines={1}>
            Voice: {voice.name}
          </Text>
        </Pressable>
        {SLEEP.map((m) => (
          <Pressable key={m} style={styles.chip} onPress={() => player.sleep(m)}>
            <Text style={styles.chipText}>☾ {m}m</Text>
          </Pressable>
        ))}
        {p.sleepAt && (
          <Pressable style={[styles.chip, styles.chipOn]} onPress={() => player.sleep(null)}>
            <Text style={styles.chipTextOn}>☾ {formatMinutes((p.sleepAt - Date.now()) / 60000)} ✕</Text>
          </Pressable>
        )}
      </View>
      <Text style={[styles.small, prep.state === "no-space" && { color: colors.danger }]}>{prepLine}</Text>

      <VoiceSheet
        visible={sheet === "voice"}
        current={voice}
        onClose={() => setSheet(null)}
        onPick={async (v) => {
          setSheet(null);
          setVoice(v);
          await updateBook(bookId, { voiceId: v.id });
          player.setVoice(v.id);
        }}
      />
      <Modal visible={sheet === "chapters"} animationType="slide" transparent onRequestClose={() => setSheet(null)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Chapters</Text>
          <FlatList
            data={chapters}
            keyExtractor={(c) => String(c.start)}
            renderItem={({ item, index }) => {
              const end = chapters[index + 1]?.start ?? segments.length;
              const ready = preparer.readyIn(bookId, item.start, end);
              return (
                <Pressable
                  style={[styles.row, index === chapterIndex && styles.rowOn]}
                  onPress={() => {
                    setSheet(null);
                    player.seek(item.start);
                  }}
                >
                  <Text style={styles.rowText} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.small}>{ready === end - item.start ? "Ready" : `${Math.round((ready / (end - item.start)) * 100)}%`}</Text>
                </Pressable>
              );
            }}
          />
          <Pressable style={styles.close} onPress={() => setSheet(null)}>
            <Text style={styles.chipText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <Pressable onPress={onBack} hitSlop={12} style={{ paddingVertical: 12 }} accessibilityLabel="Back to library">
      <Text style={{ color: colors.gold, fontSize: 16 }}>‹ Library</Text>
    </Pressable>
  );
}

function VoiceSheet(props: { visible: boolean; current: SystemVoice; onClose: () => void; onPick: (v: SystemVoice) => void }) {
  const [voices, setVoices] = useState<SystemVoice[]>([]);
  useEffect(() => {
    if (props.visible) getVoices().then(setVoices, () => setVoices([]));
  }, [props.visible]);
  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Voice</Text>
        <Text style={styles.small}>
          These voices are built into your phone. Download better ones ("Enhanced" or "Premium") in your phone's settings, under
          Accessibility → Spoken Content (iPhone) or Text-to-speech (Android).
        </Text>
        <FlatList
          data={voices}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => (
            <Pressable style={[styles.row, item.id === props.current.id && styles.rowOn]} onPress={() => props.onPick(item)}>
              <Text style={styles.rowText}>
                {item.name}
                {item.enhanced ? "  ★" : ""}
              </Text>
              <Text style={styles.small}>{languageName(item.language)}</Text>
            </Pressable>
          )}
        />
        <Pressable style={styles.close} onPress={props.onClose}>
          <Text style={styles.chipText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingBottom: 12 },
  center: { alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, fontSize: 16, marginTop: 20 },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  chapter: { color: colors.gold, fontSize: 15, marginTop: 6 },
  textBox: { flex: 1, marginVertical: 12 },
  prev: { color: colors.muted, fontSize: 17, lineHeight: 26, opacity: 0.6 },
  now: { color: colors.text, fontSize: 22, lineHeight: 32, fontWeight: "500", marginVertical: 14 },
  next: { color: colors.muted, fontSize: 17, lineHeight: 26, opacity: 0.6 },
  progressRow: { gap: 6 },
  bar: { height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 4, backgroundColor: colors.gold },
  small: { color: colors.muted, fontSize: 13, marginTop: 6 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 18, paddingHorizontal: 6 },
  ctl: { color: colors.text, fontSize: 28 },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  playText: { color: colors.onGold, fontSize: 28, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, maxWidth: "100%" },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.onGold, fontSize: 14, fontWeight: "700" },
  sheet: { marginTop: "auto", maxHeight: "80%", backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  row: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowOn: { backgroundColor: colors.surfaceHigh },
  rowText: { color: colors.text, fontSize: 16, flex: 1 },
  close: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 24 },
});
