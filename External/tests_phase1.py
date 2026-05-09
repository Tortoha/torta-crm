"""Phase 1 pure-function tests for External/main.py helpers (run: python tests_phase1.py)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Stub psycopg2 if not installed in test env — none of the tested helpers need it.
import importlib

def test_media_type():
    from main import _media_type
    cases = {
        "https://s3.example.com/img.webp":         "image",
        "https://s3.example.com/photo.JPG":        "image",
        "https://s3.example.com/clip.mp4":         "video",
        "https://s3.example.com/clip.MOV?x=1":     "video",
        "https://s3.example.com/scene.glb":        "model",
        "https://s3.example.com/asset.usdz":       "model",
        "":                                        "image",
        None:                                      "image",
        "https://s3.example.com/odd.bin":          "image",
    }
    for url, exp in cases.items():
        got = _media_type(url)
        assert got == exp, f"_media_type({url!r}) → {got!r}, expected {exp!r}"
    print("test_media_type OK")


def test_is_safe_media_url():
    from main import _is_safe_media_url
    safe = [
        "https://torta-crm.s3.eu-central-1.amazonaws.com/projects/1/foo.webp",
        "https://www.youtube.com/embed/abc123",
        "https://youtu.be/abc",
        "https://player.vimeo.com/video/123",
    ]
    unsafe = [
        "http://evil.com/malicious.html",            # no https
        "https://evil.com/x.mp4",                    # not whitelisted
        "javascript:alert(1)",                       # script scheme
        "https://twitter.com/embed/x",               # not whitelisted
        "",
        None,
    ]
    for u in safe:
        assert _is_safe_media_url(u), f"expected safe: {u!r}"
    for u in unsafe:
        assert not _is_safe_media_url(u), f"expected unsafe: {u!r}"
    print("test_is_safe_media_url OK")


def test_split_keywords():
    from main import _split_keywords
    assert _split_keywords(None) == []
    assert _split_keywords("") == []
    assert _split_keywords("a,b,c") == ["a", "b", "c"]
    assert _split_keywords(" a , , b") == ["a", "b"]
    assert _split_keywords("foo,foo") == ["foo", "foo"]   # dedup is NOT done — by design
    print("test_split_keywords OK")


if __name__ == "__main__":
    test_media_type()
    test_is_safe_media_url()
    test_split_keywords()
    print("\nAll Phase 1 helper tests PASS")
