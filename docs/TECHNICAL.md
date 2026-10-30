# ECHOFORM technical reference

Details behind the [project overview](../README.md): what each part does, how measurements are
defined, and the full list of known limitations.

## What the app does

- Import by drag and drop or file picker, identified by file contents rather than extension
- Original file metadata kept separate from decoded audio properties
- Playback with seek, volume, speed and selection looping
- Multiresolution waveform with zoom, pan and sample-level detail
- Peak, RMS, crest factor, mean and full-scale sample counts, per channel
- Calibrated FFT spectrum, averaged over the scope or computed at the playhead
- Prominence-based peak detection
- Spectrogram with cursor inspection, time or time-frequency selection, region measurements,
  frequency-band zoom and PNG export
- One shared selection across player, charts and measurements
- Signal Analysis page: short-term level timeline, sample and level histograms, level range,
  silence and low-level regions, clipping intervals by channel, and DC offset warnings
- Spectral Analysis page: spectrum with centroid and rolloff markers, plus centroid, rolloff
  and flatness for the current time selection and frequency band
- Stereo Analysis page: left, right, mid and side levels, channel level difference, correlation
  overall and over time, a width index and a vectorscope. The Side signal can also be chosen as
  the channel on any spectrum or spectrogram
- Filter Laboratory: low-pass, high-pass, band-pass, notch, peaking, low-shelf and high-shelf
  filters in a chain of up to 8, with exact frequency response, original and processed spectra,
  and listening to either version
- Comparison Lab: a second recording measured against the first over their overlap, with explicit
  alignment (starts, ends, manual, or estimated by cross-correlation), optional normalisation,
  overlaid spectra, spectral difference, and time-aligned waveform difference
- Events and Pitch page: spectral-flux onsets with adjustable sensitivity, marked on the waveform
  and timeline; tempo with confidence and alternatives; a pitch track with measured harmonics and
  harmonic-to-noise ratio; an estimated noise floor and SNR with their method and limits; mains
  hum indicators; and zero-crossing rate. These jobs run only while the page is open
- Reports: recording, file, time-domain, frequency, spectral, channel, silence, clipping, filter,
  comparison and event results with their configuration, methods and limitations, as JSON, CSV or
  a standalone printable HTML document. File names can be left out
- Settings: visualization and processing defaults, a privacy statement, and optional storage of
  preferences on this device, which is off by default and deletes them when turned off

Keyboard: `Space` play/pause, `S` stop, `L` loop, `M` mute, `Esc` clear selection,
`[`/`]` set selection start/end at the playhead, `Left`/`Right` seek 1 s, `Home` go to start, `+`/`-` zoom, `0` show the whole recording.

## Testing

```bash
npm run check
```

```bash
npm run test:e2e
```

`check` runs types, lint, unit tests and a production build. The unit tests validate every
algorithm against synthetic signals. `test:e2e` drives the production build in the installed
Microsoft Edge, so it needs no browser download: file handling, playback, each lab, report exports,
settings storage, no outgoing audio, axe accessibility rules on every page, phone-width layout, and
real canvas painting. If a build fails with EPERM, a running server or a sync tool has locked
`.next`: stop the server and delete that folder, which is generated.

Measured on a 10-minute stereo 48 kHz file in the production build, on one development PC: the
waveform appears in 2.5 s, all background analysis finishes in about 20 s without blocking the
page, and zooming has a median frame of 7.5 ms and a worst frame of 90 ms.

## Architecture

```text
src/core/dsp             Pure signal processing: no React, no DOM
src/core/audio           Format identification, decoding, playback, test signals
src/core/analysis        Worker client and measurement definitions
src/core/visualization   Scales, colour maps and shared plot geometry
src/core/reports         Report model and its JSON, CSV and HTML forms
src/workers              Analysis worker and its typed message protocol
src/stores               External stores; PCM is never placed in React state
src/hooks, src/components Canvas rendering and interface
tests/unit               Scientific validation
tests/e2e                Browser workflows
```

Waveform and spectrogram draw on two canvases, so moving the playhead never repaints the data.
Long jobs in the worker yield regularly so they can be cancelled. The PCM is copied once, into
the worker, because the main thread needs the `AudioBuffer` for playback.

Filters never change the original. A chain is rendered by the worker with the same code that the
tests verify, into a separate buffer, so what you measure is what you hear. Web Audio's own filter
nodes are not used. A render holds two extra copies of the PCM, one in the worker for measurements
and one for playback; both are released when no filter is enabled. Recording B holds one more copy
in the worker.

## Measurement conventions

- **Spectrum and spectrogram** are amplitude-calibrated: a sine of amplitude A reads
  `20 log10(A)`, so a full-scale sine reads 0 dB. They are not power spectral densities.
- **RMS** follows `20 log10(RMS)`, so a full-scale sine reads -3.01 dBFS. The two scales
  intentionally differ by 3.01 dB for a sine.
- **Spectrum averaging** is in power, over frames with 50% overlap. Trailing samples that do
  not fill a whole frame are not included.
- **Mid and Side** are `(L + R) / 2` and `(L - R) / 2`, with no extra gain, in dBFS on the
  channels' scale. For stereo, the Mid signal and the channel mix are the same thing.
- **Correlation** is at zero lag and without removing the mean. It is undefined, not zero, when a
  channel is silent.
- **Width index** is Side power over Mid + Side power: 0 mono, 0.5 uncorrelated, 1 out of phase.
  It is ECHOFORM's own energy ratio, not a perceptual measure.
- **Filters** use the Audio EQ Cookbook biquads. Low-pass and high-pass above order 2 cascade
  Butterworth sections, which fix Q.
- **Onsets** are log-compressed spectral flux peaks above a local average. Events are transients,
  not beats or notes. Times are accurate to about 12 ms on sharp events.
- **Tempo** is the autocorrelation of onset strength from 40 to 240 BPM. Confidence is the
  correlation at that period. Below 0.30 no tempo is reported, though candidates are still listed.
  Ranking leans towards 120 BPM, which is a convention rather than a measurement.
- **Pitch** is YIN from 60 Hz to 2 kHz, on audio reduced to about 16 kHz. Frames with aperiodicity
  above 0.3 are left blank instead of being guessed.
- **Noise floor** is the 5th percentile of 50 ms RMS levels, ignoring digital silence. SNR subtracts
  it from the 95th percentile, and both are withheld when the evidence does not support them.
- **Comparison** timelines are A's: B starts at the offset. Metrics are never normalised.
  Comparison spectra are averaged into about 1/48-octave bands so they can be subtracted.

## Known limitations

- Not LUFS and not true peak. RMS and sample peak are reported as such.
- Interpolated peak levels can read up to about 0.35 dB high with a Hann window.
- Full-scale counting flags possible digital clipping only. Clipping intervals need 3 or more
  consecutive full-scale samples, so their total can be lower than the inspector's count.
- The level range (P95 - P10 of gated 100 ms RMS) is ECHOFORM's own definition, not EBU LRA.
- M4A/MP4 sample rate is not read, so those files decode to 48 kHz and the UI says so. WAV, FLAC,
  MP3, Ogg and ADTS AAC decode at their own rate. Bit depth is shown only for WAV and FLAC.
- Files over 1 GB are rejected. Decoding happens on the main thread because browsers do not
  offer `decodeAudioData` in workers.
- Spectrogram size is capped at 16 million cells. Longer recordings average frames into columns,
  and zooming in recomputes the visible part at finer resolution (capped at 6 million cells). The
  panel states the resolution in use.
- Region band level includes leakage from outside the band and snaps to spectrogram cells.
- Spectral descriptors skip the bins next to DC (the window's main lobe, under about 70 Hz at
  FFT 2048), so content below that is not counted.
- Spectral flatness depends on averaging: one frame of white noise reads about 0.56, not 1.
- Playback speed changes pitch.
- The frequency part of a region selection filters peaks and sets the region reading. The
  inspector's level measurements use only its time range.
- The filter chain resets when the recording is replaced. Rendering is the whole file, so a long
  recording takes a moment to update and the previous render keeps playing until it is ready.
- Processed audio is not clipped in its stored values, but playback output will clip above full
  scale. The lab counts those samples and warns. Export of processed audio is not built.
- Comparison holds two recordings, and only recording A can be played. Spectral figures use each
  recording's channel mix, so a stereo difference that cancels in the mix will not show there.
- Waveform difference needs equal sample rates, because nothing is resampled. Spectral comparison
  works across rates, up to the lower Nyquist frequency.
- Band averaging in comparison spectra lowers lone tones relative to the Spectral page.
- Offset estimation assumes both recordings hold the same material, reads the first 262 s or so
  of each, and picks the strongest lag. A low match value means the result should not be trusted.
  Time-stretched or speed-changed material cannot be aligned this way. Repetitive material is
  ambiguous: a loop or steady tone matches at every repeat, so a high match value does not prove
  the offset is the true one.
- Onset, tempo, pitch and noise were validated on synthetic signals only. Behaviour on real music
  and speech has not been measured, so thresholds may need tuning.
- Onset detection misses soft tonal changes under noise: at default sensitivity it found 107 of
  300 level steps of a tone under noise. Raising sensitivity finds more, with more false events.
- Tempo assumes a steady pulse and one tempo per range. Changing tempo gives a low or misleading
  figure, and half or double the true tempo can be ranked first.
- Pitch is not polyphonic. Chords and mixes give gaps or a wrong value. Pitch is about 10 cents
  uncertain near 2 kHz, where a period is only a few samples at 16 kHz.
- Harmonic-to-noise ratio only sees audio below about 7 kHz.
- The noise floor assumes the quietest passages are background only. Fades, reverb tails or quiet
  music can be mistaken for it, and a heavily noise-gated file reads misleadingly.
- A narrow peak at 50 or 60 Hz may be a bass note rather than hum. Hum is searched for in the
  longest quiet run, or in the whole range if that run is under about 0.35 s.
- Source separation is not built.
- Reports describe the current scope and settings, and hold no PCM. Only the printable document
  has a chart. Direct PDF export is not built; printing to PDF from the browser works.
- Keyboard users can set a time selection, but frequency regions and chart tooltips need a pointer.
  The numbers behind each chart are in the panels and in reports.
- Accessibility was checked with automated axe rules, not with a screen reader or real users.
- Real MP3, FLAC, Ogg and M4A files have not been tested. Tests use generated WAV files.
- Browser tests ran on Edge only, not Firefox or Safari.
