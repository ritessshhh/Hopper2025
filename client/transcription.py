import whisper
import sounddevice as sd
import scipy.io.wavfile as wav
import numpy as np
import torch
import torchaudio
from sklearn.cluster import KMeans
from scipy.spatial.distance import cdist
import torch.hub

# Audio settings
SAMPLERATE = 16000  # Whisper requires 16kHz
CHANNELS = 1
DURATION = 5  # Duration of recording
OUTPUT_FILE = "temp_audio.wav"

# Load Whisper model
whisper_model = whisper.load_model("base")

# Load Wav2Vec2 for speaker embeddings (No token required)
wav2vec_model = torchaudio.pipelines.WAV2VEC2_BASE.get_model()
wav2vec_model.eval()

# Load Silero VAD correctly
vad_model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad', model='silero_vad', force_reload=True)
(get_speech_timestamps, _, _, _, _) = utils

def record_audio():
    """Records audio and saves it as a WAV file"""
    try:
        audio = sd.rec(int(DURATION * SAMPLERATE), samplerate=SAMPLERATE, channels=CHANNELS, dtype="int16")
        sd.wait()
        wav.write(OUTPUT_FILE, SAMPLERATE, audio)
    except Exception as e:
        print(f"Error recording audio: {e}")

def extract_speaker_features(audio_path):
    """Extracts speaker embeddings for clustering"""
    waveform, sr = torchaudio.load(audio_path)

    # Convert to 16kHz if needed
    if sr != SAMPLERATE:
        waveform = torchaudio.transforms.Resample(orig_freq=sr, new_freq=SAMPLERATE)(waveform)

    # Get voice activity timestamps
    speech_timestamps = get_speech_timestamps(waveform, vad_model, sampling_rate=SAMPLERATE)

    embeddings = []
    timestamps = []
    
    for segment in speech_timestamps:
        start_sample = int(segment['start'])
        end_sample = int(segment['end'])
        
        # Extract features using Wav2Vec2
        with torch.no_grad():
            features = wav2vec_model.extract_features(waveform[:, start_sample:end_sample])[0]  # Extract first tensor
            mean_features = features[0].mean(dim=1).numpy()  # Compute mean correctly
            embeddings.append(mean_features.flatten())
            timestamps.append((start_sample / SAMPLERATE, end_sample / SAMPLERATE))

    return np.array(embeddings), timestamps

def cluster_speakers(embeddings, num_speakers=2):
    """Clusters speaker embeddings using KMeans"""
    if len(embeddings) < num_speakers:
        return np.zeros(len(embeddings))  # Assign all to Speaker 1 if only one speaker

    kmeans = KMeans(n_clusters=num_speakers, random_state=0, n_init=10)
    labels = kmeans.fit_predict(embeddings)
    
    return labels

def transcribe_audio(audio_path, speaker_timestamps, speaker_labels):
    """Transcribes audio and assigns speakers based on clustering"""
    result = whisper_model.transcribe(audio_path, fp16=False)

    transcript_with_speakers = []
    for segment in result["segments"]:
        start, end, text = segment["start"], segment["end"], segment["text"]

        # Ensure input arrays are 2D for cdist()
        speaker_idx = np.argmin(cdist(
            np.array([[(start + end) / 2]]),  
            np.array([[(s + e) / 2] for s, e in speaker_timestamps])
        ))
        speaker = f"Speaker {speaker_labels[speaker_idx] + 1}"  # Convert cluster index to speaker ID
        transcript_with_speakers.append(f"{speaker}: {text}")

    print("\n".join(transcript_with_speakers))

if __name__ == "__main__":
    print("LETS GOO")
    record_audio()
    embeddings, timestamps = extract_speaker_features(OUTPUT_FILE)
    speaker_labels = cluster_speakers(embeddings, num_speakers=2)  # Adjust number of speakers as needed
    transcribe_audio(OUTPUT_FILE, timestamps, speaker_labels)
