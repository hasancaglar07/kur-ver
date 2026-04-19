import struct
from pathlib import Path


class MediaValidationError(Exception):
    pass


def parse_mp4_duration_seconds(path: Path) -> float:
    with path.open("rb") as f:
        f.seek(0, 2)
        end = f.tell()
        f.seek(0)

        while f.tell() < end:
            box_start = f.tell()
            header = f.read(8)
            if len(header) < 8:
                break
            size, box_type = struct.unpack(">I4s", header)
            box_name = box_type.decode("latin1")
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
                header_size = 16
            else:
                header_size = 8

            if size < header_size:
                break

            if box_name == "moov":
                moov_end = box_start + size
                while f.tell() < moov_end:
                    sub_start = f.tell()
                    sub_header = f.read(8)
                    if len(sub_header) < 8:
                        break
                    sub_size, sub_type = struct.unpack(">I4s", sub_header)
                    sub_name = sub_type.decode("latin1")
                    if sub_size == 1:
                        sub_size = struct.unpack(">Q", f.read(8))[0]
                        sub_header_size = 16
                    else:
                        sub_header_size = 8

                    if sub_name == "mvhd":
                        version = struct.unpack(">B", f.read(1))[0]
                        f.read(3)
                        if version == 1:
                            f.read(16)
                            timescale = struct.unpack(">I", f.read(4))[0]
                            duration = struct.unpack(">Q", f.read(8))[0]
                        else:
                            f.read(8)
                            timescale = struct.unpack(">I", f.read(4))[0]
                            duration = struct.unpack(">I", f.read(4))[0]
                        if timescale <= 0:
                            raise MediaValidationError("Invalid MP4 timescale")
                        return duration / timescale

                    f.seek(sub_start + sub_size)

            f.seek(box_start + size)

    raise MediaValidationError("Unable to parse MP4 duration")
