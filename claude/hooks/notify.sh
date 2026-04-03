#!/bin/bash

input=$(cat)

message=$(echo "$input" | jq -r '.message // empty' 2>/dev/null)
title=$(echo "$input" | jq -r '.title // empty' 2>/dev/null)

terminal-notifier \
  -title "${title:-Claude Code}" \
  -message "${message:-Waiting for input}" \
  -sound default \
  -activate com.mitchellh.ghostty 2>/dev/null

exit 0
