from transcribers import Segment, clean_segments


def test_drops_empty_and_strips():
    segs = [Segment(0, 1, "  こんにちは "), Segment(1, 2, "   "), Segment(2, 3, "")]
    out = clean_segments(segs)
    assert [s.text for s in out] == ["こんにちは"]


def test_drops_silence_hallucination():
    segs = [
        Segment(0, 2, "本当の発言", no_speech_prob=0.1, avg_logprob=-0.3),
        Segment(2, 5, "ご視聴ありがとうございました", no_speech_prob=0.9, avg_logprob=-1.5),
        # 無音確率は高いが確信度も高いものは残す（Whisper本家と同じ判定）
        Segment(5, 6, "はい", no_speech_prob=0.7, avg_logprob=-0.2),
    ]
    assert [s.text for s in clean_segments(segs)] == ["本当の発言", "はい"]


def test_clamps_times():
    segs = [Segment(-0.5, 0.8, "a"), Segment(3.0, 2.0, "b"), Segment(59.0, 61.234, "c")]
    out = clean_segments(segs, duration_sec=60.0)
    assert (out[0].start, out[0].end) == (0.0, 0.8)
    assert (out[1].start, out[1].end) == (3.0, 3.0)
    assert (out[2].start, out[2].end) == (59.0, 60.0)


def test_strips_leading_dialogue_dash():
    segs = [Segment(0, 1, " - 出てきます。"), Segment(1, 2, "－あー"), Segment(2, 3, "-"), Segment(3, 4, "マイナス-1度")]
    assert [s.text for s in clean_segments(segs)] == ["出てきます。", "あー", "マイナス-1度"]
