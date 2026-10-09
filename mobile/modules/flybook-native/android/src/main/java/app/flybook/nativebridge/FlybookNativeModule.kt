package app.flybook.nativebridge

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageDestination
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDNamedDestination
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class FlybookNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // One engine for the app's lifetime; requests wait until it has started.
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val waiting = mutableListOf<(TextToSpeech?) -> Unit>()
  private val pending = ConcurrentHashMap<String, Pair<File, Promise>>()
  private val pdfExecutor = Executors.newSingleThreadExecutor()

  private fun withEngine(block: (TextToSpeech?) -> Unit) = synchronized(this) {
    if (ttsReady) return@synchronized block(tts)
    waiting.add(block)
    if (tts != null) return@synchronized
    tts = TextToSpeech(context) { status ->
      val engine = if (status == TextToSpeech.SUCCESS) tts else null
      engine?.setOnUtteranceProgressListener(listener)
      val ready = synchronized(this) {
        ttsReady = true
        if (engine == null) tts = null
        waiting.toList().also { waiting.clear() }
      }
      ready.forEach { it(engine) }
    }
  }

  private val listener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) {}

    override fun onDone(utteranceId: String) {
      val (file, promise) = pending.remove(utteranceId) ?: return
      promise.resolve(mapOf("durationMs" to durationMs(file)))
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String) {
      pending.remove(utteranceId)?.second?.reject("ERR_TTS", "The voice couldn't read this sentence.", null)
    }

    override fun onError(utteranceId: String, errorCode: Int) {
      pending.remove(utteranceId)?.second?.reject("ERR_TTS", "The voice couldn't read this sentence ($errorCode).", null)
    }
  }

  private fun durationMs(file: File): Double {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
    } catch (e: Exception) {
      0.0
    } finally {
      retriever.release()
    }
  }

  private fun offlineVoices(engine: TextToSpeech): List<Voice> =
    (engine.voices ?: emptySet()).filter { !it.isNetworkConnectionRequired && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }

  private fun toFile(path: String): File = File(if (path.startsWith("file://")) Uri.parse(path).path!! else path)

  override fun definition() = ModuleDefinition {
    Name("FlybookNative")

    AsyncFunction("getVoices") { promise: Promise ->
      withEngine { engine ->
        if (engine == null) return@withEngine promise.reject("ERR_TTS", "No text-to-speech engine on this phone.", null)
        promise.resolve(offlineVoices(engine).map {
          mapOf(
            "id" to it.name,
            "name" to it.name,
            "language" to it.locale.toLanguageTag(),
            "enhanced" to (it.quality >= Voice.QUALITY_HIGH),
          )
        })
      }
    }

    AsyncFunction("renderToFile") { text: String, voiceId: String, rate: Double, path: String, promise: Promise ->
      withEngine { engine ->
        if (engine == null) return@withEngine promise.reject("ERR_TTS", "No text-to-speech engine on this phone.", null)
        val voice = offlineVoices(engine).find { it.name == voiceId }
          ?: return@withEngine promise.reject("ERR_VOICE", "This voice isn't available on the phone any more.", null)
        val file = toFile(path)
        file.parentFile?.mkdirs()
        val id = UUID.randomUUID().toString()
        pending[id] = file to promise
        // The engine keeps the last voice and rate, so set both every time.
        engine.voice = voice
        engine.setSpeechRate(rate.toFloat())
        if (engine.synthesizeToFile(text, Bundle(), file, id) != TextToSpeech.SUCCESS) {
          pending.remove(id)
          promise.reject("ERR_TTS", "The voice couldn't start.", null)
        }
      }
    }

    AsyncFunction("extractPdf") { uri: String, promise: Promise ->
      pdfExecutor.execute {
        try {
          promise.resolve(readPdf(uri))
        } catch (e: Exception) {
          val message = e.message ?: ""
          promise.reject(
            "ERR_PDF",
            if (message.contains("password", ignoreCase = true)) "This PDF is password-protected." else "This file couldn't be opened — it may be damaged.",
            e,
          )
        }
      }
    }

    OnDestroy {
      tts?.shutdown()
      tts = null
      pdfExecutor.shutdown()
    }
  }

  private fun readPdf(uri: String): Map<String, Any?> {
    PDFBoxResourceLoader.init(context)
    val input = context.contentResolver.openInputStream(Uri.parse(uri)) ?: throw IllegalArgumentException("Can't open file")
    input.use { stream ->
      PDDocument.load(stream).use { doc ->
        val pages = mutableListOf<Map<String, Any>>()
        val stripper = LineStripper()
        for (i in 1..doc.numberOfPages) {
          stripper.lines.clear()
          stripper.startPage = i
          stripper.endPage = i
          stripper.getText(doc)
          pages.add(mapOf("page" to i, "lines" to stripper.lines.toList()))
        }
        val outline = mutableListOf<Map<String, Any>>()
        doc.documentCatalog.documentOutline?.let { collectOutline(doc, it, outline) }
        return mapOf(
          "pageCount" to doc.numberOfPages,
          "title" to doc.documentInformation?.title?.takeIf { it.isNotBlank() },
          "pages" to pages,
          "outline" to outline,
        )
      }
    }
  }

  private fun collectOutline(doc: PDDocument, node: PDOutlineNode, out: MutableList<Map<String, Any>>) {
    for (item in node.children()) {
      val title = item.title?.trim().orEmpty()
      val dest = try {
        item.destination ?: (item.action as? com.tom_roush.pdfbox.pdmodel.interactive.action.PDActionGoTo)?.destination
      } catch (e: Exception) {
        null
      }
      val pageDest = when (dest) {
        is PDPageDestination -> dest
        is PDNamedDestination -> doc.documentCatalog.findNamedDestinationPage(dest)
        else -> null
      }
      val page = pageDest?.retrievePageNumber()?.takeIf { it >= 0 }
      if (title.isNotEmpty() && page != null) out.add(mapOf("title" to title, "page" to page + 1))
      collectOutline(doc, item, out)
    }
  }

  /**
   * Collects one entry per text line with its top position and font size.
   * The stripper reports a line word by word, then calls writeLineSeparator.
   */
  private class LineStripper : PDFTextStripper() {
    val lines = mutableListOf<Map<String, Any>>()
    private val words = StringBuilder()
    private val positions = mutableListOf<TextPosition>()

    init {
      sortByPosition = true
    }

    override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
      if (words.isNotEmpty()) words.append(' ')
      words.append(text)
      positions.addAll(textPositions)
    }

    override fun writeLineSeparator() {
      flush()
    }

    override fun writePageEnd() {
      flush()
      super.writePageEnd()
    }

    private fun flush() {
      val clean = words.toString().replace(Regex("\\s+"), " ").trim()
      if (clean.isNotEmpty() && positions.isNotEmpty()) {
        // fontSizeInPt already includes the text matrix scale; some PDFs set it to 1 and scale elsewhere.
        val size = positions.maxOf { if (it.fontSizeInPt > 1f) it.fontSizeInPt else it.heightDir }.toDouble()
        val height = positions.maxOf { it.heightDir }.toDouble()
        // yDirAdj is the baseline measured from the top; the line's top is one height above it.
        val top = positions.minOf { it.yDirAdj }.toDouble() - height
        lines.add(mapOf("text" to clean, "fontSize" to size, "y" to top, "height" to height))
      }
      words.setLength(0)
      positions.clear()
    }
  }
}
