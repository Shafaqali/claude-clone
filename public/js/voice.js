let recognition = null;

export function supported() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

export function startListening({ onText, onEnd, onError } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.("Voice input is not supported in this browser.");
    return;
  }

  recognition?.stop();
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = event => {
    let text = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    onText?.(text, event.results[event.results.length - 1].isFinal);
  };
  recognition.onerror = event => onError?.(event.error);
  recognition.onend = () => {
    recognition = null;
    onEnd?.();
  };
  recognition.start();
}

export function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*#`]/g, ""));
  utterance.rate = 1;
  speechSynthesis.speak(utterance);
}