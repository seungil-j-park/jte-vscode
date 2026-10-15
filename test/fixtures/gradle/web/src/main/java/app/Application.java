package app;

/** Exercise the web module source root and its dependency on another module. */
public final class Application {
    /** Return a record imported from the model module. */
    public demo.Person person() { return new demo.Person("Test", 21); }
}
