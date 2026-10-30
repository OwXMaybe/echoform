export interface MetricDoc {
  title: string;
  formula?: string;
  meaning: string;
  kind: "Measured" | "Derived" | "Estimated";
}

export const METRIC_DOCS = {
  onsets: {
    title: "Onset detection",
    formula: "flux[t] = sum over bins of max(0, log(1 + 1000 |X[t]|) - log(1 + 1000 |X[t-1]|))",
    meaning:
      "Log-compressed spectral flux: how much new energy arrives in each frame. An onset is a peak that stands above the average of the surrounding half second. These are transient events, not beats or notes: one note can give several, and a slow swell may give none. Sensitivity changes the bar a peak must clear.",
    kind: "Estimated",
  },
  tempo: {
    title: "Tempo estimate",
    formula: "autocorrelation of onset strength, 40 to 240 BPM",
    meaning:
      "Looks for a repeating period in the onset curve. Confidence is the correlation at that period, from 0 to 1. Ranking favours moderate tempi, because a pulse also correlates at half and double its rate and the signal alone cannot settle that, so check the alternatives. Below 0.30 no tempo is reported: many recordings have none.",
    kind: "Estimated",
  },
  pitch: {
    title: "Pitch estimate",
    formula: "YIN: first dip of d'(tau) below 0.15, f0 = sample rate / tau",
    meaning:
      "Finds the repetition period of the waveform in 20 ms windows, between 60 Hz and 2 kHz. It suits one voice or instrument. Chords and mixtures have no single period, so the track shows gaps or a wrong value there; it is not a transcription. Frames that are not periodic enough are left blank.",
    kind: "Estimated",
  },
  harmonics: {
    title: "Harmonics",
    formula: "peak nearest n · f0, level relative to the fundamental",
    meaning:
      "Looks for a distinct spectral peak near each multiple of the median pitch. A dash means no such peak exists. Results depend on the signal: noisy, polyphonic or non-periodic recordings can give misleading rows, and a higher FFT size separates low harmonics better.",
    kind: "Estimated",
  },
  harmonicToNoise: {
    title: "Harmonic-to-noise ratio",
    formula: "HNR = 10 log10((1 - d') / d'),  d' = median aperiodicity",
    meaning:
      "How much of the signal repeats from one period to the next, from the same frames as the pitch track, below about 7 kHz. It only means something for a periodic source, so it is shown only when a pitch was found.",
    kind: "Estimated",
  },
  noiseFloor: {
    title: "Noise floor estimate",
    formula: "5th percentile of 50 ms RMS levels, ignoring digital silence",
    meaning:
      "Assumes the quietest passages contain only background. Mixed audio cannot prove that, so the figure is withheld when level barely changes, and rated low when quiet passages are rare. Signal-to-noise is the 95th percentile minus the floor, given only with moderate confidence. Neither is a laboratory measurement.",
    kind: "Estimated",
  },
  hum: {
    title: "Mains hum indicator",
    formula: "narrow peak at 50 or 60 Hz, 12 dB above nearby bins",
    meaning:
      "A narrow peak at a mains frequency can mean electrical hum, but a bass note at that pitch looks identical. Treat it as something to check, not a diagnosis.",
    kind: "Estimated",
  },
  correlation: {
    title: "Channel correlation",
    formula: "r = sum(L R) / sqrt(sum L^2 · sum R^2)",
    meaning:
      "How alike the two channels' waveforms are at the same instant, from -1 to +1. Near +1 they move together and sum strongly to mono. Near 0 they are unrelated, which often sounds wide. Near -1 they are inverted, so content cancels in a mono mix. It ignores level differences and delay, and one number cannot describe how a stereo image sounds.",
    kind: "Measured",
  },
  stereoWidth: {
    title: "Stereo width",
    formula: "width = S^2 / (M^2 + S^2),  using RMS of Mid and Side",
    meaning:
      "ECHOFORM's width index: the share of the signal's power in the side channel. 0 is mono, 0.5 is uncorrelated channels of equal level, and 1 is fully out of phase. It is an energy ratio, not a measure of perceived width.",
    kind: "Derived",
  },
  midSide: {
    title: "Mid and side",
    formula: "Mid = (L + R) / 2,  Side = (L - R) / 2",
    meaning:
      "Levels are in dBFS on the same scale as the channels, with no extra gain. Identical full-scale channels therefore give a 0 dBFS peak in Mid and nothing in Side. L = Mid + Side and R = Mid - Side, so nothing is lost.",
    kind: "Derived",
  },
  levelDifference: {
    title: "Channel level difference",
    formula: "L RMS (dB) - R RMS (dB)",
    meaning: "Positive means the left channel has more power over the measured range.",
    kind: "Derived",
  },
  vectorscope: {
    title: "Vectorscope",
    formula: "x = Side, y = Mid, brightness = log(sample count)",
    meaning:
      "Every sample in the range, plotted by its mid and side values. A vertical line is mono, a diagonal is one channel alone, a horizontal line is out of phase, and a filled cloud means the channels differ.",
    kind: "Measured",
  },
  filterResponse: {
    title: "Frequency response",
    formula: "H(z) = product of (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)",
    meaning:
      "The gain the enabled filters apply at each frequency, evaluated exactly from their coefficients. Designs follow the Audio EQ Cookbook; higher orders cascade Butterworth sections. These are IIR filters, so they also shift phase.",
    kind: "Measured",
  },
  zeroCrossingRate: {
    title: "Zero-crossing rate",
    formula: "sign changes per second",
    meaning:
      "How often the waveform changes sign. A sine crosses at twice its frequency. Noisy or bright material crosses more often. It says little about mixtures, depends on content and any DC offset, and is not a pitch measurement.",
    kind: "Measured",
  },
  alignment: {
    title: "Alignment",
    formula: "time in A = time in B + offset",
    meaning:
      "Two files need not start at the same event, so ECHOFORM never assumes they do: you choose how they line up. Align starts and Align ends use the file boundaries. Estimate finds the lag with the highest cross-correlation of the mixes, which assumes both contain the same material; check its match value. Repetitive material can match equally well at several offsets, so a high value is not proof. Everything is measured only where the aligned recordings overlap.",
    kind: "Estimated",
  },
  normalisation: {
    title: "Normalisation",
    formula: "gain on B = A level - B level",
    meaning:
      "Optionally scales B to match A's RMS or peak over the compared interval, so the charts show differences in shape rather than level. It changes the overlaid spectrum and the waveform views, never the numbers in the metrics table, and B's file is not altered.",
    kind: "Derived",
  },
  spectralDifference: {
    title: "Spectral difference",
    formula: "difference (dB) = B level - A level, about 1/48 octave bands",
    meaning:
      "Both spectra are averaged into the same log-spaced bands so they can be subtracted even at different sample rates, up to the lower Nyquist frequency. Averaging lowers lone tones compared with the Spectral page. Positive means B has more energy in that band.",
    kind: "Derived",
  },
  waveformDifference: {
    title: "Waveform difference",
    formula: "d[n] = A[n] - gain · B[n]",
    meaning:
      "Sample-by-sample subtraction of the mixes after alignment and normalisation. It is only meaningful at equal sample rates and exact alignment: a one-sample error can leave a large residual at high frequencies even for identical audio.",
    kind: "Measured",
  },
  peak: {
    title: "Peak level",
    formula: "peak = max |x[n]|,  dBFS = 20 log10(peak)",
    meaning:
      "The largest absolute sample value. 0 dBFS is digital full scale. This is the sample peak; the waveform between samples can rise slightly higher (true peak is not measured).",
    kind: "Measured",
  },
  extremes: {
    title: "Maximum positive / negative",
    formula: "max x[n],  min x[n]",
    meaning:
      "The highest and lowest sample values. A strong imbalance between them can indicate DC offset or an asymmetric waveform.",
    kind: "Measured",
  },
  rms: {
    title: "RMS level",
    formula: "RMS = sqrt((1/N) sum x[n]^2),  dBFS = 20 log10(RMS)",
    meaning:
      "Root-mean-square amplitude: a measure of average signal power. A full-scale sine reads -3.01 dBFS on this scale. It is a digital level, not perceived loudness, and not LUFS.",
    kind: "Measured",
  },
  mean: {
    title: "Mean (DC offset)",
    formula: "mean = (1/N) sum x[n]",
    meaning:
      "The signed average of the samples. Audio normally averages close to zero; a sustained non-zero value is DC offset.",
    kind: "Measured",
  },
  crest: {
    title: "Crest factor",
    formula: "crest = peak / RMS",
    meaning:
      "How far peaks stand above the average level. A sine is 3.01 dB. Heavily limited audio is low; sparse transient material is high.",
    kind: "Derived",
  },
  clipping: {
    title: "Samples at full scale",
    formula: "count of |x[n]| >= 0.99996",
    meaning:
      "Samples at or within rounding of digital full scale. This indicates possible digital clipping only: it cannot detect distortion from analog stages or clipping that was later turned down.",
    kind: "Measured",
  },
  spectrum: {
    title: "Magnitude spectrum",
    formula: "level = 10 log10(avg(|2 X[k] / sum w|^2)),  f = k fs / N",
    meaning:
      "Windowed FFT frames with 50% overlap, averaged in power and calibrated so a sine of amplitude A reads 20 log10(A); a full-scale sine reads 0 dB. It is an amplitude spectrum, not a power spectral density: broadband noise reads lower as the FFT gets larger.",
    kind: "Measured",
  },
  resolution: {
    title: "FFT size and resolution",
    formula: "frequency resolution = fs / N",
    meaning:
      "A larger FFT separates closer frequencies but spans more time, blurring when events happen. A smaller FFT locates events in time precisely but merges nearby frequencies.",
    kind: "Derived",
  },
  window: {
    title: "Window function",
    meaning:
      "An FFT assumes the frame repeats forever, so a tone that does not fit a whole number of cycles leaks across bins. A window tapers the frame to reduce this. Rectangular is the sharpest but leaks most; Hann is a good default; Blackman leaks least with the widest main lobe.",
    kind: "Measured",
  },
  peaks: {
    title: "Prominent frequency peaks",
    formula: "prominence = height above the higher of the side minima",
    meaning:
      "Local maxima that stand out from their surroundings by at least the chosen prominence and are separated by a minimum distance. Frequency and level are refined by parabolic interpolation, which can overstate a tone's level by up to about 0.35 dB with a Hann window. These are spectral peaks, not notes or fundamentals.",
    kind: "Estimated",
  },
  region: {
    title: "Region band level",
    formula: "level = 10 log10(mean over time(sum over band P[k]) / (2 ENBW))",
    meaning:
      "RMS-equivalent level of the selected box, from the spectrogram's cells and corrected for the window's noise bandwidth. A tone alone in the band reads the same as its RMS. Leakage from outside the band is included, and the box edges snap to spectrogram cells, so it inherits the current FFT and hop resolution.",
    kind: "Estimated",
  },
  centroid: {
    title: "Spectral centroid",
    formula: "centroid = sum(f[k] A[k]) / sum(A[k])",
    meaning:
      "The amplitude-weighted average frequency: the spectrum's centre of mass. It is associated with perceived brightness but does not measure it, and a recording with strong lows and strong highs can have its centroid where there is little energy.",
    kind: "Derived",
  },
  rolloff: {
    title: "Spectral rolloff",
    formula: "lowest f[R] where sum(P[k], k <= R) >= percentage of sum(P[k])",
    meaning:
      "The frequency below which the chosen share of spectral energy lies. It is resolved to one FFT bin, and with a selected band it describes that band only.",
    kind: "Derived",
  },
  flatness: {
    title: "Spectral flatness",
    formula: "flatness = geometric mean(P[k]) / arithmetic mean(P[k])",
    meaning:
      "Near 1 for noise-like spectra and near 0 for tonal ones. It is a property of the averaged spectrum: longer averaging pushes noise closer to 1, and a single frame of white noise reads about 0.56. In decibels, 0 dB is perfectly flat.",
    kind: "Derived",
  },
  silence: {
    title: "Silence and low-level regions",
    formula: "every channel's 10 ms RMS < threshold, for at least the minimum duration",
    meaning:
      "Digital silence means every sample in the region is exactly zero. Low-level means the audio is quiet but present: room tone or a fade can fall below the threshold without being silent. Padding keeps that much audio at each edge of a region. The result depends on the settings you choose.",
    kind: "Measured",
  },
  clipIntervals: {
    title: "Clipping intervals",
    formula: "3 or more consecutive samples with |x[n]| >= 0.99996, merged across 10 ms gaps",
    meaning:
      "Flat runs at digital full scale are strong evidence of digital clipping. One isolated full-scale sample is not counted, so this total can be lower than the inspector's full-scale count. Analog distortion, or clipping that was later turned down, leaves no such runs and cannot be detected here.",
    kind: "Estimated",
  },
  dcOffset: {
    title: "DC offset",
    formula: "mean = (1/N) sum x[n]",
    meaning:
      "The signed average of the samples in the scope. Audio usually averages close to zero, but a short selection can have a non-zero mean simply because it holds an uneven part of a slow wave. The warning threshold is your choice, not a standard.",
    kind: "Measured",
  },
  sampleHistogram: {
    title: "Sample value distribution",
    formula: "count of samples in 101 equal bins from -1 to +1",
    meaning:
      "How often each amplitude occurs, on a logarithmic count axis. A sine piles up at its extremes, noise and music usually peak around zero, and a spike at the outer edges points to limiting or clipping.",
    kind: "Measured",
  },
  dynamics: {
    title: "Short-term level range",
    formula: "range = P95 - P10 of 100 ms RMS blocks at or above -70 dBFS",
    meaning:
      "How far the level moves across the scope. Blocks below -70 dBFS are gated out so silence does not inflate it. This is ECHOFORM's own definition: it is not EBU loudness range (LRA) or any other standard, and it is unweighted.",
    kind: "Derived",
  },
  spectrogram: {
    title: "Spectrogram",
    formula: "STFT frames every hop samples; colour = level in dB",
    meaning:
      "Each column is a windowed FFT, using the same calibration as the spectrum. The hop sets the time step. Very long recordings power-average frames into columns to fit memory; the panel states when that happens.",
    kind: "Measured",
  },
} as const satisfies Record<string, MetricDoc>;

export type MetricId = keyof typeof METRIC_DOCS;
