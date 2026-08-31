#!/usr/bin/env python3
"""The trailer's score. Written rather than sampled, so it is ours to ship.

Same musical material as the site: a slow low drone, and a pentatonic bell that
rings once for each message the film stops on.
"""
import numpy as np
import wave, sys, math

SR = 48000
DUR = 36.8
n = int(SR * DUR)
t = np.arange(n) / SR
out = np.zeros(n, dtype=np.float64)


def env(start, length, attack=0.01, release=None):
    """A one-shot amplitude envelope over the whole timeline."""
    release = release if release is not None else length * 0.8
    e = np.zeros(n)
    a0, a1 = int(start * SR), int((start + attack) * SR)
    r0, r1 = a1, min(n, int((start + length) * SR))
    if a1 > a0:
        e[a0:a1] = np.linspace(0, 1, a1 - a0)
    if r1 > r0:
        e[r0:r1] = np.exp(-np.linspace(0, 6, r1 - r0))
    return e


# ——— the drone ———————————————————————————————————————————————————————
# A minor-ish stack, detuned a few cents apart so it beats slowly instead of
# sitting still. This is the sound of the field itself.
for i, f in enumerate([55.0, 82.41, 110.0, 164.81, 220.0]):
    detune = 1 + (i - 2) * 0.0009
    breathe = 1 + 0.20 * np.sin(2 * np.pi * (0.035 + i * 0.011) * t + i)
    amp = 0.13 / (i * 0.7 + 1)
    out += amp * breathe * np.sin(2 * np.pi * f * detune * t)
    out += amp * 0.22 * np.sin(2 * np.pi * f * detune * 2 * t)   # a quiet octave

# lift the whole bed as the camera pulls back and the galaxy appears
swell = np.clip((t - 25.8) / 5.0, 0, 1) ** 1.6
for f in [329.63, 415.30, 493.88]:
    out += 0.035 * swell * np.sin(2 * np.pi * f * t + f)


def bell(at, midi, gain=1.0, length=5.0):
    """A struck bell: a few inharmonic partials, each decaying at its own rate."""
    f0 = 440 * 2 ** ((midi - 69) / 12)
    e = env(at, length, attack=0.004)
    s = np.zeros(n)
    for k, (mult, amp, dec) in enumerate([
            (1.0, 1.0, 1.0), (2.01, 0.42, 1.7), (2.99, 0.22, 2.4),
            (4.16, 0.11, 3.4), (5.43, 0.06, 4.6)]):
        decay = np.exp(-np.clip(t - at, 0, None) * dec * 0.6)
        s += amp * decay * np.sin(2 * np.pi * f0 * mult * t + k)
    return 0.16 * gain * e * s


# ——— one bell per message the film lands on ——————————————————————————
# C-major pentatonic, so every note agrees with the drone and with the others.
# one bell per message the film lands on
for at, midi in [(2.9, 72), (8.6, 76), (23.7, 79)]:
    out += bell(at, midi, 1.0)

# the pocket montage: one strike per cut, climbing the pentatonic as the cuts
# climb the spectrum — red at the bottom, violet at the top, which is the
# actual order of the thing
for i, at in enumerate([11.7, 13.6, 15.5, 17.4, 19.3]):
    out += bell(at, 74 + i * 3, 0.7, length=3.0)

# the pull-back: the three notes again, spread out and an octave up
for i, (at, midi) in enumerate([(26.7, 84), (28.4, 79), (30.1, 88), (31.7, 76)]):
    out += bell(at, midi, 0.55 - i * 0.06, length=7.0)

# a last one under the title
out += bell(33.9, 72, 0.8, length=6.0)

# ——— polish ——————————————————————————————————————————————————————————
# gentle one-pole low-pass to take the edge off the digital sines
a = 0.16
y = np.zeros(n)
acc = 0.0
for i in range(n):
    acc += a * (out[i] - acc)
    y[i] = acc
out = 0.55 * out + 0.75 * y

out *= np.clip(t / 1.6, 0, 1)                       # fade in
out *= np.clip((DUR - t) / 2.2, 0, 1)               # fade out
peak = np.max(np.abs(out))
out = out / peak * 0.72

stereo = np.stack([out, np.roll(out, 240)], axis=1)  # a hair of width
pcm = (stereo * 32767).astype(np.int16)

path = sys.argv[1] if len(sys.argv) > 1 else 'score.wav'
with wave.open(path, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'wrote {path} — {DUR:.1f}s')
