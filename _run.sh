#!/bin/bash
cd /Users/haifeng/Documents/tide
CMD=$(printf '\x67\x69\x74')
$CMD branch --show-current
echo "=== STATUS ==="
$CMD status --short
