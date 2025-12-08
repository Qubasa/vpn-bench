"""Retry utilities for making benchmark operations more robust."""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import ParamSpec

log = logging.getLogger(__name__)

P = ParamSpec("P")


@dataclass
class RetryResult[R]:
    """Result of a retry operation with metadata."""

    result: R
    attempts: int  # Total number of attempts (1 = success on first try)


def retry_with_backoff[R](
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    max_total_time: float | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """
    Decorator that retries a function with exponential backoff.

    Args:
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        backoff_factor: Multiplier for delay after each retry
        exceptions: Tuple of exception types to catch and retry
        max_total_time: Maximum total time in seconds for all attempts combined.
                        If exceeded, no more retries will be attempted.

    Returns:
        Decorated function with retry logic
    """

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            delay = initial_delay
            last_exception: Exception | None = None
            start_time = time.monotonic()

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    elapsed = time.monotonic() - start_time

                    # Check if we've exceeded total time budget
                    if max_total_time is not None and elapsed >= max_total_time:
                        log.error(
                            f"{func.__name__} failed after {elapsed:.1f}s "
                            f"(max_total_time={max_total_time}s exceeded): {e}"
                        )
                        break

                    if attempt < max_retries:
                        log.warning(
                            f"{func.__name__} failed (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                            f"Retrying in {delay:.1f}s..."
                        )
                        time.sleep(delay)
                        delay = min(delay * backoff_factor, max_delay)
                    else:
                        log.error(
                            f"{func.__name__} failed after {max_retries + 1} attempts: {e}"
                        )

            assert last_exception is not None
            raise last_exception

        return wrapper

    return decorator


def retry_operation[R](
    operation: Callable[[], R],
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    operation_name: str = "operation",
    max_total_time: float | None = None,
) -> R:
    """
    Execute an operation with retry logic and exponential backoff.

    Args:
        operation: Callable to execute
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        backoff_factor: Multiplier for delay after each retry
        exceptions: Tuple of exception types to catch and retry
        operation_name: Name for logging purposes
        max_total_time: Maximum total time in seconds for all attempts combined.
                        If exceeded, no more retries will be attempted.

    Returns:
        Result of the operation

    Raises:
        The last exception if all retries fail
    """
    delay = initial_delay
    last_exception: Exception | None = None
    start_time = time.monotonic()

    for attempt in range(max_retries + 1):
        try:
            return operation()
        except exceptions as e:
            last_exception = e
            elapsed = time.monotonic() - start_time

            # Check if we've exceeded total time budget
            if max_total_time is not None and elapsed >= max_total_time:
                log.error(
                    f"{operation_name} failed after {elapsed:.1f}s "
                    f"(max_total_time={max_total_time}s exceeded): {e}"
                )
                break

            if attempt < max_retries:
                log.warning(
                    f"{operation_name} failed (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                    f"Retrying in {delay:.1f}s..."
                )
                time.sleep(delay)
                delay = min(delay * backoff_factor, max_delay)
            else:
                log.exception(
                    f"{operation_name} failed after {max_retries + 1} attempts."
                )

    assert last_exception is not None
    raise last_exception


class MaxRetriesExceededError(Exception):
    """Raised when maximum number of retries is exceeded."""


def retry_operation_with_info[R](
    operation: Callable[[], R],
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    operation_name: str = "operation",
    max_total_time: float | None = None,
) -> RetryResult[R]:
    """
    Execute an operation with retry logic and return metadata about attempts.

    Args:
        operation: Callable to execute
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        backoff_factor: Multiplier for delay after each retry
        exceptions: Tuple of exception types to catch and retry
        operation_name: Name for logging purposes
        max_total_time: Maximum total time in seconds for all attempts combined.
                        If exceeded, no more retries will be attempted.

    Returns:
        RetryResult containing the result and number of attempts

    Raises:
        The last exception if all retries fail
    """
    delay = initial_delay
    last_exception: Exception | None = None
    start_time = time.monotonic()

    for attempt in range(max_retries + 1):
        try:
            result = operation()
            return RetryResult(result=result, attempts=attempt + 1)
        except exceptions as e:
            last_exception = e
            elapsed = time.monotonic() - start_time

            # Check if we've exceeded total time budget
            if max_total_time is not None and elapsed >= max_total_time:
                log.error(
                    f"{operation_name} failed after {elapsed:.1f}s "
                    f"(max_total_time={max_total_time}s exceeded): {e}"
                )
                break

            if attempt < max_retries:
                log.warning(
                    f"{operation_name} failed (attempt {attempt + 1}/{max_retries + 1}). "
                    f"Retrying in {delay:.1f}s..."
                )
                time.sleep(delay)
                delay = min(delay * backoff_factor, max_delay)
            else:
                log.exception(
                    f"{operation_name} failed after {max_retries + 1} attempts"
                )

    assert last_exception is not None
    raise last_exception
