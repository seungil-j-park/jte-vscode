package demo;

/** Provide record accessors and overloads for template analysis tests. */
public record Person(String name, int age) {
    public static final String LABEL = "Person";
    /** Provide the overload accepting a string argument. */
    public String greet(String prefix) { return prefix + name; }
    /** Provide the overload accepting an integer argument. */
    public String greet(int times) { return name.repeat(times); }
    /** Provide a nested record type for navigation tests. */
    public record Address(String city) {}
}
