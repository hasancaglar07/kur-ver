from redis import Redis
from rq import Worker

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    redis_conn = Redis.from_url(settings.redis_url)
    queue_names = [settings.redis_queue_name]

    worker = Worker(
        queue_names,
        connection=redis_conn,
        name=f"kurban-worker-{settings.redis_queue_name}",
    )
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()
