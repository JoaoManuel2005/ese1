#!/usr/bin/env python3
"""
Interactive helper to run a single command with AWS/Bedrock credentials typed interactively.

Usage:
  python scripts/run_with_creds.py -- pytest -q tests/test_bedrock_integration.py

The script prompts for AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION, and BEDROCK_MODEL_ID
and runs the provided command with those values in the child environment. Nothing is written to disk.
"""
import argparse
import getpass
import os
import shlex
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('cmd', nargs=argparse.REMAINDER, help='Command to run (e.g. pytest -q tests/test_bedrock_integration.py)')
    args = parser.parse_args()

    if not args.cmd:
        print('No command provided. Example: python scripts/run_with_creds.py -- pytest -q tests/test_bedrock_integration.py')
        sys.exit(2)

    aws_access_key = getpass.getpass('AWS_ACCESS_KEY_ID: ')
    aws_secret = getpass.getpass('AWS_SECRET_ACCESS_KEY: ')
    aws_region = input('AWS_DEFAULT_REGION [us-west-2]: ') or 'us-west-2'
    bedrock_model = input('BEDROCK_MODEL_ID: ')
    # Optional: Llama / third-party API key (treated as secret)
    llama_key = getpass.getpass('LLAMA_CLOUD_API_KEY (optional, leave blank if none): ')

    env = os.environ.copy()
    env.update({
        'AWS_ACCESS_KEY_ID': aws_access_key,
        'AWS_SECRET_ACCESS_KEY': aws_secret,
        'AWS_DEFAULT_REGION': aws_region,
        'BEDROCK_MODEL_ID': bedrock_model,
        'LLAMA_CLOUD_API_KEY': llama_key,
    })

    # Run the provided command
    cmd = args.cmd
    # If the first argument is '--', strip it
    if cmd and cmd[0] == '--':
        cmd = cmd[1:]

    print('\nRunning:', ' '.join(shlex.quote(c) for c in cmd))

    try:
        rc = subprocess.call(cmd, env=env)
        # Overwrite sensitive variables in memory
        aws_access_key = None
        aws_secret = None
        bedrock_model = None
        sys.exit(rc)
    except KeyboardInterrupt:
        print('Interrupted')
        sys.exit(1)


if __name__ == '__main__':
    main()
