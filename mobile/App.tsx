import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { sampleBook } from "../shared/sample";

// Foundation screen: proves the shared text pipeline runs on the phone.
export default function App() {
  const book = useMemo(() => sampleBook(), []);
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.brand}>FlyBook</Text>
        <Text style={styles.title}>{book.title}</Text>
        <Text style={styles.muted}>
          {book.chapters.length} chapters · {book.segments.length} sentences · {book.words} words
        </Text>
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
  muted: { color: "#9fb3a8", fontSize: 14, marginBottom: 12 },
  chapter: { color: "#efeadc", fontSize: 17, paddingVertical: 6 },
});
