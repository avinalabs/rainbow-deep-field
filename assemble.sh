#!/usr/bin/env bash
# Cuts the rendered frames, the caption, the end card and the score into one file.
#   usage: ./assemble.sh wide|tall
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-wide}"
FRAMES="frames-$MODE"
[ -d "$FRAMES" ] || { echo "no $FRAMES/ — run: node trailer.js $MODE"; exit 1; }

BODY=33.3        # length of the rendered footage
CAP_IN=27.6      # the caption rides the pull-back
CAP_OUT=31.4
END=4.2          # how long the title card holds
XF=0.7           # crossfade into it

mkdir -p out

ffmpeg -y -loglevel error \
  -framerate 30 -i "$FRAMES/%04d.jpg" \
  -loop 1 -i "cards/caption-$MODE.png" \
  -filter_complex "[1:v]format=rgba,fade=t=in:st=$CAP_IN:d=0.9:alpha=1,fade=t=out:st=$CAP_OUT:d=0.8:alpha=1[cap];\
[0:v][cap]overlay=0:0:shortest=1,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf 17 -r 30 out/_body.mp4

ffmpeg -y -loglevel error \
  -loop 1 -t "$END" -i "cards/end-$MODE.png" \
  -vf "format=yuv420p" -c:v libx264 -preset slow -crf 17 -r 30 out/_end.mp4

OFFSET=$(python3 -c "print($BODY - $XF)")

ffmpeg -y -loglevel error \
  -i out/_body.mp4 -i out/_end.mp4 -i score.wav \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=$XF:offset=$OFFSET,format=yuv420p[v]" \
  -map "[v]" -map 2:a \
  -c:v libx264 -preset slow -crf 17 -movflags +faststart \
  -c:a aac -b:a 192k -ar 48000 -shortest \
  "out/rainbow-deep-field-$MODE.mp4"

rm -f out/_body.mp4 out/_end.mp4
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "out/rainbow-deep-field-$MODE.mp4"
echo "→ out/rainbow-deep-field-$MODE.mp4"
