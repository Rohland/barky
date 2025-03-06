#!/bin/bash

export LC_CTYPE=C
export LANG=C

LONG_STRING=$(head -c 100000 /dev/urandom | tr -dc 'A-Za-z0-9')

LONG_STRING="${LONG_STRING:0:16000}"

# Echo it in chunks of 8192 bytes
CHUNK_SIZE=8192
for ((i=0; i<${#LONG_STRING}; i+=CHUNK_SIZE)); do
    echo -n "${LONG_STRING:i:CHUNK_SIZE}"
done

# Ensure a newline at the end
echo
