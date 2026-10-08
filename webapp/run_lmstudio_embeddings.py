#!/usr/bin/env python3
"""
Run LM Studio embedding for Japan music tracks.
Usage: python3 run_lmstudio_embeddings.py --region Japan --model nomic-embed-text-v1.5
"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from lmstudio_bridge import LMStudioBridge

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="Japan")
    parser.add_argument("--model", default="nomic-embed-text-v1.5")
    parser.add_argument("--check", action="store_true", help="Check LM Studio server status")
    args = parser.parse_args()

    bridge = LMStudioBridge()
    
    if args.check:
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(bridge.check_server())
        print(f"LM Studio Status: {result}")
        sys.exit(0 if result.get("status") == "online" else 1)
    
    # Generate embeddings for Japan tracks
    tracks_path = f"/home/bons/music-playlist/data/{args.region}/tracks.jsonl"
    
    if not os.path.exists(tracks_path):
        print(f"❌ Tracks file not found: {tracks_path}")
        sys.exit(1)
    
    print(f"Generating embeddings for region: {args.region}")
    print(f"Using LM Studio model: {args.model}")
    print("This may take a moment...")
    
    tracks = bridge.embed_music_tracks(tracks_path)
    
    # Save embeddings to JSONL
    output_path = f"/home/bons/music-playlist/data/{args.region}/tracks_with_embeddings.jsonl"
    with open(output_path, "w", encoding="utf-8") as f:
        for track in tracks:
            # Remove embedding from JSON (optional - keep only if needed)
            # For now, save full data including embedding
            import json
            f.write(json.dumps(track) + "\n")
    
    print(f"✅ Embedded {len(tracks)} tracks")
    print(f"Output: {output_path}")
    for track in tracks:
        print(f"  - {track.get('artist', '')} - {track.get('title', '')} (embedding dim: {len(track.get('embedding', []))})")
