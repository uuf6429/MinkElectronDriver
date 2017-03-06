## Roadmap
-[ ] Response loops should not be infinite, specify a hard limit relative to the operation (eg; getting content should take less than 30s)
-[x] Refactor all response loop methods to use the same method (pass mtd, args, interval and limit as args)
-[ ] Support more driver features
-[ ] Ensure mink driver test suite passes
-[ ] Unit tests and code coverage of stuff missed by the mink driver test suite
-[ ] Try on a real-live test case (eg; an existing behat setup)
-[ ] Pass debug level to server so we avoid a lot of DEBUG messages (for example)
